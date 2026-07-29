import { describe, expect, test } from 'bun:test'
import { configureFailedJobs, failedJobs, MemoryFailedJobStore } from '../src/failed'
import { Job, registerJob, serializeJob } from '../src/job'
import { QueueManager } from '../src/manager'
import { MemoryRateLimiter, ReleaseJob, WithoutOverlapping } from '../src/middleware'
import { MemoryQueueStore } from '../src/store'
import { configureUniqueJobs, MemoryUniqueLock } from '../src/unique'
import { Worker } from '../src/worker'

class AlwaysFails extends Job {
  override tries = 1
  async handle(): Promise<void> {
    throw new Error('boom')
  }
}
registerJob(AlwaysFails)

describe('failed jobs record the queue they came from', () => {
  // Regression: `log(connection, queue, …)` was handed `connection` TWICE, so
  // a job that failed on `high` was recorded under a queue named after its
  // connection. `queue:retry` then re-pushed it to that non-existent queue and
  // forgot the failed row — reporting "re-queued" while losing the job.
  test('the queue column is the job queue, not the connection name', async () => {
    configureFailedJobs(new MemoryFailedJobStore())
    const store = new MemoryQueueStore()
    await store.push(JSON.stringify(serializeJob(new AlwaysFails())), { queue: 'high' })

    await new Worker(store, {
      connection: 'redis',
      queues: ['high'],
      failed: failedJobs(),
    }).work({ once: true })

    const record = (await failedJobs()!.all())[0]
    expect(record?.connection).toBe('redis')
    expect(record?.queue).toBe('high')
  })
})

describe('MemoryRateLimiter prunes an elapsed window', () => {
  // Regression: `tooManyAttempts` read the raw hit count and only `hit()`
  // pruned — but `hit()` is skipped once the limit is reached. So a key that
  // hit its limit stayed over it forever, and since a release doesn't burn an
  // attempt, `RateLimited` released the job endlessly: it never ran and never
  // failed.
  test('a key stops being limited once its window elapses', async () => {
    const limiter = new MemoryRateLimiter()
    await limiter.hit('reports', 0.02)
    await limiter.hit('reports', 0.02)
    expect(await limiter.tooManyAttempts('reports', 2)).toBe(true)

    await new Promise(resolve => setTimeout(resolve, 60))
    expect(await limiter.tooManyAttempts('reports', 2)).toBe(false)
  })

  test('it still limits after the window resets', async () => {
    // The prune must not turn the limiter into a no-op.
    const limiter = new MemoryRateLimiter()
    await limiter.hit('reports', 60)
    expect(await limiter.tooManyAttempts('reports', 1)).toBe(true)
  })
})

describe('unique-job lock is not leaked by a failed dispatch', () => {
  // Regression: the lock was acquired BEFORE the push closure, which may be
  // deferred to after-commit (and dropped on rollback) or may throw partway.
  // Either way nothing was queued while the lock stayed held for `uniqueFor` —
  // an hour by default — so every later dispatch silently did nothing.
  class OneAtATime extends Job {
    override unique = true
    override uniqueId(): string {
      return 'only'
    }

    async handle(): Promise<void> {}
  }
  registerJob(OneAtATime)

  const managerWith = (store: unknown) => {
    const manager = new QueueManager({
      default: 'x',
      connections: { x: { driver: 'memory' } },
    } as never)
    ;(manager as unknown as { store(): unknown }).store = () => store
    return manager
  }

  const stub = (onPush: () => Promise<void>) => ({
    push: onPush,
    async pop() { return null },
    async release() {},
    async size() { return 0 },
  })

  test('a push that throws releases the lock', async () => {
    const lock = new MemoryUniqueLock()
    configureUniqueJobs(lock)
    const failing = stub(async () => {
      throw new Error('store down')
    })

    await expect(managerWith(failing).push(new OneAtATime())).rejects.toThrow('store down')
    // Free again, so the job can actually be dispatched on a later attempt.
    expect(await lock.acquire('unique:OneAtATime:only', 60)).toBe(true)
  })

  test('uniqueness still dedupes on the happy path', async () => {
    configureUniqueJobs(new MemoryUniqueLock())
    const pushes: string[] = []
    const manager = managerWith(stub(async () => void pushes.push('pushed')))

    await manager.push(new OneAtATime())
    await manager.push(new OneAtATime())
    expect(pushes).toHaveLength(1)
  })
})

describe('WithoutOverlapping does not release a lapsed lock', () => {
  class Task extends Job {
    async handle(): Promise<void> {}
  }

  test('a job that outruns expireAfter leaves the next holder alone', async () => {
    // Regression: `release()` was an unconditional delete. Once the job
    // outran `expireAfter` its own lock had lapsed and another worker could
    // hold the key — deleting it removed THAT worker's lock and let a third
    // in on top, turning one overrun into a cascade.
    const lock = new MemoryUniqueLock()
    configureUniqueJobs(lock)
    const middleware = new WithoutOverlapping('report', { expireAfter: 0.05 })

    const slow = middleware.handle(new Task(), async () => {
      await new Promise(resolve => setTimeout(resolve, 120))
    })

    await new Promise(resolve => setTimeout(resolve, 80)) // let the TTL lapse
    expect(await lock.acquire('overlap:report', 60)).toBe(true) // a second worker takes it

    await slow // its `finally` must not touch the new holder's lock
    expect(await lock.acquire('overlap:report', 60)).toBe(false)
  })

  test('a job inside its window still releases immediately', async () => {
    // The guard must not make a fast job hold the lock for the whole TTL.
    const lock = new MemoryUniqueLock()
    configureUniqueJobs(lock)
    await new WithoutOverlapping('report', { expireAfter: 60 }).handle(new Task(), async () => {})
    expect(await lock.acquire('overlap:report', 60)).toBe(true)
  })

  test('a concurrent run is still prevented', async () => {
    const lock = new MemoryUniqueLock()
    configureUniqueJobs(lock)
    const middleware = new WithoutOverlapping('report', { expireAfter: 60 })
    let bodies = 0

    const first = middleware.handle(new Task(), async () => {
      bodies++
      await new Promise(resolve => setTimeout(resolve, 50))
    })
    await expect(middleware.handle(new Task(), async () => void bodies++)).rejects.toBeInstanceOf(ReleaseJob)
    await first
    expect(bodies).toBe(1)
  })
})
