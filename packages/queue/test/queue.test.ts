import { beforeEach, describe, expect, test } from 'bun:test'
import { FailedJobRepository, MemoryFailedJobStore } from '../src/failed'
import { configureAfterCommit, dispatch, dispatchSync, QueueManager, setDefaultQueue } from '../src/manager'
import { Job, registerJob, reconstructJob, serializeJob } from '../src/job'
import { configureUniqueJobs, MemoryUniqueLock } from '../src/unique'
import {
  configureDatabaseQueue,
  DatabaseQueueStore,
  MemoryQueueStore,
  type QueueDbAdapter,
  RedisQueueStore,
  type RedisLike,
} from '../src/store'
import { Worker } from '../src/worker'

// ── test jobs ───────────────────────────────────────────────────────────────
const ran: string[] = []

class RecordJob extends Job {
  constructor(public tag = '') {
    super()
  }
  handle(): void {
    ran.push(this.tag)
  }
}

let attemptCount = 0
class FlakyJob extends Job {
  override tries = 3
  failedWith: unknown = null
  handle(): void {
    attemptCount++
    throw new Error(`boom ${attemptCount}`)
  }
  override failed(error: unknown): void {
    this.failedWith = error
  }
}

class TunedJob extends Job {
  override tries = 5
  override backoff = [1, 2, 3]
  override timeout = 30
  override maxExceptions = 2
  handle(): void {}
}

class SlowJob extends Job {
  override timeout = 0.05 // 50ms
  async handle(): Promise<void> {
    await new Promise((r) => setTimeout(r, 200))
  }
}

registerJob(RecordJob, FlakyJob, TunedJob, SlowJob)

beforeEach(() => {
  ran.length = 0
  attemptCount = 0
})

// ── serialization ────────────────────────────────────────────────────────────
describe('job serialization', () => {
  test('serialize captures public fields, reconstruct restores prototype', () => {
    const s = serializeJob(new RecordJob('hello'))
    expect(s.job).toBe('RecordJob')
    expect(s.data).toEqual({ tag: 'hello' })
    expect(s.config.tries).toBe(1)
    const job = reconstructJob(s)
    expect(job).toBeInstanceOf(RecordJob)
    job.handle()
    expect(ran).toEqual(['hello'])
  })

  test('config fields (tries/backoff/timeout/maxExceptions) are carried, not payload', () => {
    const s = serializeJob(new FlakyJob())
    expect(s.data).toEqual({ failedWith: null })
    expect(s.config).toEqual({ tries: 3 })
    const s2 = serializeJob(new TunedJob())
    expect(s2.config).toEqual({ tries: 5, backoff: [1, 2, 3], timeout: 30, maxExceptions: 2 })
    const job = reconstructJob(s2) as TunedJob
    expect(job.backoff).toEqual([1, 2, 3])
    expect(job.timeout).toBe(30)
    expect(job.maxExceptions).toBe(2)
  })

  test('reconstruct throws for unknown job', () => {
    expect(() => reconstructJob({ job: 'Nope', data: {}, config: { tries: 1 } })).toThrow(/Unknown job "Nope"/)
  })
})

// ── manager: sync + dispatch helpers ──────────────────────────────────────────
describe('QueueManager (sync)', () => {
  test('sync runs jobs inline', async () => {
    const m = new QueueManager({ default: 'sync' })
    await m.push(new RecordJob('a'))
    expect(ran).toEqual(['a'])
  })

  test('dispatch()/dispatchSync() use the default manager', async () => {
    setDefaultQueue(new QueueManager({ default: 'sync' }))
    await dispatch(new RecordJob('d'))
    await dispatchSync(new RecordJob('s'))
    expect(ran).toEqual(['d', 's'])
  })

  test('unknown connection throws', () => {
    const m = new QueueManager({ default: 'sync' })
    expect(() => m.store('nope')).toThrow(/not defined/)
  })
})

// ── worker: memory store, retries, failed() ───────────────────────────────────
describe('Worker (memory store)', () => {
  test('processes queued jobs', async () => {
    const store = new MemoryQueueStore()
    const m = new QueueManager({ default: 'memory', connections: { memory: { driver: 'memory' } } })
    // push directly through the store the manager built
    await store.push(JSON.stringify(serializeJob(new RecordJob('q1'))))
    await store.push(JSON.stringify(serializeJob(new RecordJob('q2'))))
    const worker = new Worker(store)
    const processed = await worker.work({ stopWhenEmpty: true })
    expect(processed).toBe(2)
    expect(ran.sort()).toEqual(['q1', 'q2'])
    void m
  })

  test('retries up to tries then calls failed()', async () => {
    const store = new MemoryQueueStore()
    await store.push(JSON.stringify(serializeJob(new FlakyJob())))
    const errors: boolean[] = []
    const worker = new Worker(store, { onError: (_n, _e, willRetry) => errors.push(willRetry) })
    const processed = await worker.work({ stopWhenEmpty: true })
    // 3 attempts total: attempt 1 (retry), 2 (retry), 3 (give up)
    expect(processed).toBe(3)
    expect(attemptCount).toBe(3)
    expect(errors).toEqual([true, true, false])
    expect(await store.size()).toBe(0)
  })

  test('once processes a single job', async () => {
    const store = new MemoryQueueStore()
    await store.push(JSON.stringify(serializeJob(new RecordJob('once'))))
    await store.push(JSON.stringify(serializeJob(new RecordJob('later'))))
    expect(await new Worker(store).work({ once: true })).toBe(1)
    expect(ran).toEqual(['once'])
    expect(await store.size()).toBe(1)
  })

  test('delayed jobs are not popped early', async () => {
    const store = new MemoryQueueStore()
    await store.push(JSON.stringify(serializeJob(new RecordJob('soon'))), { delaySeconds: 3600 })
    expect(await store.pop()).toBeNull()
    expect(await store.size()).toBe(1)
  })
})

// ── failed jobs ───────────────────────────────────────────────────────────────
describe('failed jobs', () => {
  test('exhausted job is recorded to the failed store', async () => {
    const store = new MemoryQueueStore()
    const failed = new FailedJobRepository(new MemoryFailedJobStore())
    await store.push(JSON.stringify(serializeJob(new FlakyJob())))
    await new Worker(store, { connection: 'database', failed }).work({ stopWhenEmpty: true })

    const rows = await failed.all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.connection).toBe('database')
    expect(rows[0]?.exception).toContain('boom')
  })

  test('retry re-pushes the body and forget removes it', async () => {
    const store = new MemoryQueueStore()
    const adapter = new MemoryFailedJobStore()
    const failed = new FailedJobRepository(adapter)
    await store.push(JSON.stringify(serializeJob(new FlakyJob())))
    await new Worker(store, { connection: 'memory', failed }).work({ stopWhenEmpty: true })

    const [rec] = await failed.all()
    expect(rec).toBeDefined()
    // simulate `queue:retry`: re-push the stored body, then forget
    await store.push((rec as { body: string }).body)
    expect(await store.size()).toBe(1)
    expect(await failed.forget((rec as { id: string }).id)).toBe(true)
    expect(await failed.all()).toHaveLength(0)
  })

  test('flush clears everything', async () => {
    const failed = new FailedJobRepository(new MemoryFailedJobStore())
    await failed.log('sync', 'sync', '{}', new Error('x'))
    await failed.log('sync', 'sync', '{}', new Error('y'))
    expect(await failed.all()).toHaveLength(2)
    await failed.flush()
    expect(await failed.all()).toHaveLength(0)
  })
})

// ── afterCommit ───────────────────────────────────────────────────────────────
describe('afterCommit dispatch', () => {
  test('defers the push to the registered hook', async () => {
    const deferred: Array<() => void | Promise<void>> = []
    configureAfterCommit((cb) => deferred.push(cb))
    const store = new MemoryQueueStore()
    const m = new QueueManager({ default: 'memory', connections: { memory: { driver: 'memory' } } })
    // reach into the manager's resolved store
    ;(m as unknown as { resolved: Map<string, unknown> }).resolved.set('memory', store)

    await m.push(new RecordJob('deferred'), { afterCommit: true })
    expect(await store.size()).toBe(0) // not pushed yet
    for (const cb of deferred) await cb() // simulate commit
    expect(await store.size()).toBe(1)
    configureAfterCommit(() => {}) // reset hook
  })
})

// ── unique jobs ───────────────────────────────────────────────────────────────
describe('unique jobs', () => {
  class UniqueJob extends Job {
    override unique = true
    constructor(public key = '') {
      super()
    }
    override uniqueId(): string {
      return this.key
    }
    handle(): void {}
  }
  registerJob(UniqueJob)

  test('second dispatch is skipped while the first is queued', async () => {
    configureUniqueJobs(new MemoryUniqueLock())
    const store = new MemoryQueueStore()
    const m = new QueueManager({ default: 'memory', connections: { memory: { driver: 'memory' } } })
    ;(m as unknown as { resolved: Map<string, unknown> }).resolved.set('memory', store)

    await m.push(new UniqueJob('a'))
    await m.push(new UniqueJob('a')) // duplicate → skipped
    await m.push(new UniqueJob('b')) // different id → allowed
    expect(await store.size()).toBe(2)
  })

  test('lock is released after processing, allowing re-dispatch', async () => {
    configureUniqueJobs(new MemoryUniqueLock())
    const store = new MemoryQueueStore()
    const m = new QueueManager({ default: 'memory', connections: { memory: { driver: 'memory' } } })
    ;(m as unknown as { resolved: Map<string, unknown> }).resolved.set('memory', store)

    await m.push(new UniqueJob('x'))
    await new Worker(store).work({ stopWhenEmpty: true }) // processes → releases lock
    await m.push(new UniqueJob('x')) // now allowed again
    expect(await store.size()).toBe(1)
  })
})

// ── retry reliability: backoff / timeout / maxExceptions ──────────────────────
describe('retry reliability', () => {
  test('backoff array sets per-attempt release delay', async () => {
    const delays: number[] = []
    const store = new MemoryQueueStore()
    // spy on release to capture the delay
    const orig = store.release.bind(store)
    store.release = (record, delay) => {
      delays.push(delay)
      return orig(record, 0) // re-push immediately so the manual drain can re-pop
    }
    // a job that always fails, tries=3, backoff [10, 20]
    class BackoffJob extends Job {
      override tries = 3
      override backoff = [10, 20]
      handle(): void {
        throw new Error('nope')
      }
    }
    registerJob(BackoffJob)
    await store.push(JSON.stringify(serializeJob(new BackoffJob())))
    // drain manually so delayed releases don't block the test
    for (let i = 0; i < 3; i++) await new Worker(store).processNext()
    // attempt 1 → backoff[0]=10, attempt 2 → backoff[1]=20 (attempt 3 exhausts, no release)
    expect(delays).toEqual([10, 20])
  })

  test('maxExceptions caps attempts below tries', async () => {
    class CappedJob extends Job {
      override tries = 5
      override maxExceptions = 2
      handle(): void {
        attemptCount++
        throw new Error('x')
      }
    }
    registerJob(CappedJob)
    const store = new MemoryQueueStore()
    await store.push(JSON.stringify(serializeJob(new CappedJob())))
    await new Worker(store).work({ stopWhenEmpty: true })
    expect(attemptCount).toBe(2) // stopped at maxExceptions, not tries=5
  })

  test('timeout fails a slow job', async () => {
    const store = new MemoryQueueStore()
    const failed = new FailedJobRepository(new MemoryFailedJobStore())
    await store.push(JSON.stringify(serializeJob(new SlowJob())))
    await new Worker(store, { failed }).work({ stopWhenEmpty: true })
    // handle() exceeded the 50ms timeout → treated as failed (tries=1, no retry)
    expect(await store.size()).toBe(0)
    const rows = await failed.all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.exception).toContain('timed out')
  })
})

// ── named queues / priority ───────────────────────────────────────────────────
describe('named queues', () => {
  test('pop honors queue priority order', async () => {
    const store = new MemoryQueueStore()
    await store.push(JSON.stringify(serializeJob(new RecordJob('low1'))), { queue: 'low' })
    await store.push(JSON.stringify(serializeJob(new RecordJob('high1'))), { queue: 'high' })
    await store.push(JSON.stringify(serializeJob(new RecordJob('low2'))), { queue: 'low' })

    // worker prefers 'high' then 'low'
    await new Worker(store, { queues: ['high', 'low'] }).work({ stopWhenEmpty: true })
    expect(ran).toEqual(['high1', 'low1', 'low2'])
  })

  test('size can target a single queue', async () => {
    const store = new MemoryQueueStore()
    await store.push(JSON.stringify(serializeJob(new RecordJob('a'))), { queue: 'emails' })
    await store.push(JSON.stringify(serializeJob(new RecordJob('b'))), { queue: 'default' })
    expect(await store.size('emails')).toBe(1)
    expect(await store.size()).toBe(2)
  })

  test('a job dispatched to a queue is invisible to a worker on another', async () => {
    const store = new MemoryQueueStore()
    await store.push(JSON.stringify(serializeJob(new RecordJob('only-high'))), { queue: 'high' })
    const processed = await new Worker(store, { queues: ['default'] }).work({ stopWhenEmpty: true })
    expect(processed).toBe(0)
    expect(ran).toEqual([])
  })
})

// ── redis store (fake ZSET client) ────────────────────────────────────────────
class FakeRedisZSet implements RedisLike {
  private sets = new Map<string, { score: number; member: string }[]>()
  async send(command: string, args: string[]): Promise<unknown> {
    const key = args[0] as string
    const set = this.sets.get(key) ?? []
    switch (command) {
      case 'ZADD': {
        const score = Number(args[1])
        const member = args[2] as string
        set.push({ score, member })
        this.sets.set(key, set)
        return 1
      }
      case 'ZRANGEBYSCORE': {
        const max = Number(args[2])
        const ready = set.filter((e) => e.score <= max).sort((a, b) => a.score - b.score)
        return ready.slice(0, 1).map((e) => e.member)
      }
      case 'ZREM': {
        this.sets.set(
          key,
          set.filter((e) => e.member !== args[1]),
        )
        return 1
      }
      case 'ZCARD':
        return set.length
      default:
        return null
    }
  }
}

describe('RedisQueueStore (fake client — logic only)', () => {
  test('push/pop/release round-trips through the worker', async () => {
    const store = new RedisQueueStore(new FakeRedisZSet(), 'queues:test')
    await store.push(JSON.stringify(serializeJob(new RecordJob('r1'))))
    expect(await store.size()).toBe(1)
    await new Worker(store).work({ stopWhenEmpty: true })
    expect(ran).toEqual(['r1'])
    expect(await store.size()).toBe(0)
  })
})

// ── database store (fake adapter) ─────────────────────────────────────────────
describe('DatabaseQueueStore (fake adapter)', () => {
  test('push/takeReady/count via the injected adapter', async () => {
    const rows: { id: string; body: string; attempts: number; availableAt: number; queue: string }[] = []
    const adapter: QueueDbAdapter = {
      insert: async (id, body, attempts, availableAt, queue) => {
        rows.push({ id, body, attempts, availableAt, queue })
      },
      takeReady: async (now, queues) => {
        for (const queue of queues) {
          const ready = rows
            .filter((r) => r.queue === queue && r.availableAt <= now)
            .sort((a, b) => a.availableAt - b.availableAt)
          const next = ready[0]
          if (!next) continue
          rows.splice(rows.indexOf(next), 1)
          return { id: next.id, body: next.body, attempts: next.attempts, queue: next.queue }
        }
        return null
      },
      count: async (queue) => (queue ? rows.filter((r) => r.queue === queue).length : rows.length),
    }
    configureDatabaseQueue(adapter)
    const store = new DatabaseQueueStore()
    await store.push(JSON.stringify(serializeJob(new RecordJob('db1'))))
    expect(await store.size()).toBe(1)
    await new Worker(store).work({ stopWhenEmpty: true })
    expect(ran).toEqual(['db1'])
    expect(await store.size()).toBe(0)
  })
})
