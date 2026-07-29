import { describe, expect, test } from 'bun:test'
import { configureFailedJobs, failedJobs, MemoryFailedJobStore } from '../src/failed'
import { Job, registerJob, serializeJob } from '../src/job'
import { MemoryRateLimiter } from '../src/middleware'
import { MemoryQueueStore } from '../src/store'
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
