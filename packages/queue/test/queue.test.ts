import { beforeEach, describe, expect, test } from 'bun:test'
import { Bus, configureBatches, findBatch, MemoryBatchStore } from '../src/batch'
import { configureJobEncryption } from '../src/encryption'
import { configureQueueEventDispatcher, Queue } from '../src/events'
import { FailedJobRepository, MemoryFailedJobStore } from '../src/failed'
import { configureAfterCommit, dispatch, dispatchSync, QueueManager, setDefaultQueue } from '../src/manager'
import { decodeBody, encodeBody, Job, registerJob, reconstructJob, serializeJob } from '../src/job'
import { configureUniqueJobs, MemoryUniqueLock } from '../src/unique'
import { configureModelSerializer } from '../src/serializes-models'
import { configureRestartSignal } from '../src/restart'
import {
  configureRateLimiter,
  type JobMiddleware,
  MemoryRateLimiter,
  RateLimited,
  ReleaseJob,
  runThroughMiddleware,
} from '../src/middleware'
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

// ── job batching ──────────────────────────────────────────────────────────────
describe('job batching', () => {
  class BatchOk extends Job {
    handle(): void {
      const store = globalThis as Record<string, unknown>
      store.__okRan = ((store.__okRan as number | undefined) ?? 0) + 1
    }
  }
  class BatchFail extends Job {
    handle(): void {
      throw new Error('batch-fail')
    }
  }
  registerJob(BatchOk, BatchFail)

  const g = globalThis as Record<string, unknown>
  const setup = () => {
    configureBatches(new MemoryBatchStore())
    const m = new QueueManager({ default: 'memory', connections: { memory: { driver: 'memory' } } })
    setDefaultQueue(m)
    g.__okRan = 0
    g.__then = false
    g.__catch = false
    g.__finally = false
    return m.store('memory') as InstanceType<typeof MemoryQueueStore>
  }

  test('then + finally run when all jobs succeed; progress reaches 100', async () => {
    const store = setup()
    const batch = await Bus.batch([new BatchOk(), new BatchOk()])
      .name('imports')
      .then(() => {
        ;(globalThis as Record<string, unknown>).__then = true
      })
      .finally(() => {
        ;(globalThis as Record<string, unknown>).__finally = true
      })
      .dispatch()
    expect(batch.total).toBe(2)
    expect(batch.progress()).toBe(0)

    await new Worker(store).work({ stopWhenEmpty: true })
    expect(g.__okRan).toBe(2)
    expect(g.__then).toBe(true)
    expect(g.__finally).toBe(true)
    const after = await findBatch(batch.id)
    expect(after?.processed).toBe(2)
    expect(after?.progress()).toBe(100)
    expect(after?.finished).toBe(true)
  })

  test('failure cancels the batch: catch runs, then does not, remaining jobs skip', async () => {
    const store = setup()
    const batch = await Bus.batch([new BatchFail(), new BatchOk()])
      .then(() => {
        ;(globalThis as Record<string, unknown>).__then = true
      })
      .catch(() => {
        ;(globalThis as Record<string, unknown>).__catch = true
      })
      .finally(() => {
        ;(globalThis as Record<string, unknown>).__finally = true
      })
      .dispatch()

    await new Worker(store).work({ stopWhenEmpty: true })
    expect(g.__catch).toBe(true)
    expect(g.__then).toBe(false) // never all-success
    expect(g.__okRan).toBe(0) // second job skipped because batch cancelled
    const after = await findBatch(batch.id)
    expect(after?.cancelled).toBe(true)
  })

  test('allowFailures keeps the batch running (then skipped, finally runs)', async () => {
    const store = setup()
    await Bus.batch([new BatchFail(), new BatchOk()])
      .allowFailures()
      .then(() => {
        ;(globalThis as Record<string, unknown>).__then = true
      })
      .finally(() => {
        ;(globalThis as Record<string, unknown>).__finally = true
      })
      .dispatch()

    await new Worker(store).work({ stopWhenEmpty: true })
    expect(g.__okRan).toBe(1) // second job still ran
    expect(g.__then).toBe(false) // had a failure
    expect(g.__finally).toBe(true)
  })
})

// ── model serialization (re-fetch) ────────────────────────────────────────────
describe('model serialization', () => {
  // a fake model + store that re-fetches fresh values
  const db: Record<string, { id: number; name: string }> = {
    '1': { id: 1, name: 'fresh-alice' },
    '2': { id: 2, name: 'fresh-bob' },
  }
  class FakeUser {
    constructor(
      public id: number,
      public name: string,
    ) {}
  }

  class ModelJob extends Job {
    constructor(public user: FakeUser = new FakeUser(0, '')) {
      super()
    }
    handle(): void {
      ran.push((this.user as FakeUser).name)
    }
  }
  registerJob(ModelJob)

  test('stores a reference and re-fetches a fresh model on the worker', async () => {
    configureModelSerializer({
      dehydrate: (v) => (v instanceof FakeUser ? { model: 'FakeUser', id: v.id } : undefined),
      hydrate: async (ref) => {
        const row = db[String(ref.id)]
        return row ? new FakeUser(row.id, row.name) : null
      },
    })

    // the job is created with a STALE copy; the worker must re-fetch fresh
    const serialized = serializeJob(new ModelJob(new FakeUser(1, 'stale-alice')))
    expect(serialized.data.user).toEqual({ __ravel_model__: { model: 'FakeUser', id: 1 } })

    const store = new MemoryQueueStore()
    await store.push(encodeBody(serialized))
    await new Worker(store).work({ stopWhenEmpty: true })
    expect(ran).toEqual(['fresh-alice']) // re-fetched, not the stale name
    configureModelSerializer({ dehydrate: () => undefined, hydrate: async () => null }) // reset
  })
})

// ── graceful restart ──────────────────────────────────────────────────────────
describe('queue:restart signal', () => {
  test('worker stops when a restart is requested after it started', async () => {
    let requestedAt: number | null = null
    configureRestartSignal({
      requestedAt: async () => requestedAt,
      request: async () => {
        requestedAt = Date.now() + 10_000 // in the future → newer than worker start
      },
    })
    const store = new MemoryQueueStore()
    // request restart BEFORE working; worker should exit immediately (0 processed)
    await (async () => {
      requestedAt = Date.now() + 10_000
    })()
    await store.push(JSON.stringify(serializeJob(new RecordJob('should-not-run'))))
    const processed = await new Worker(store).work({ stopWhenEmpty: true })
    expect(processed).toBe(0)
    expect(ran).toEqual([])
    configureRestartSignal({ requestedAt: async () => null, request: async () => {} }) // reset
  })
})

// ── encrypted jobs ────────────────────────────────────────────────────────────
describe('encrypted jobs', () => {
  class SecretJob extends Job {
    override encrypt = true
    constructor(public msg = '') {
      super()
    }
    handle(): void {
      ran.push(this.msg)
    }
  }
  registerJob(SecretJob)

  test('payload is encrypted at rest and round-trips', async () => {
    configureJobEncryption('a-test-secret')
    const body = encodeBody(serializeJob(new SecretJob('top-secret')))
    expect(body.startsWith('ENC:')).toBe(true)
    expect(body).not.toContain('top-secret')
    const decoded = decodeBody(body)
    expect(decoded.job).toBe('SecretJob')
    expect(decoded.data).toEqual({ msg: 'top-secret' })
  })

  test('worker decrypts and runs an encrypted job', async () => {
    configureJobEncryption('a-test-secret')
    const store = new MemoryQueueStore()
    const m = new QueueManager({ default: 'memory', connections: { memory: { driver: 'memory' } } })
    ;(m as unknown as { resolved: Map<string, unknown> }).resolved.set('memory', store)
    await m.push(new SecretJob('classified'))
    await new Worker(store).work({ stopWhenEmpty: true })
    expect(ran).toEqual(['classified'])
  })
})

// ── queued closures ───────────────────────────────────────────────────────────
describe('queued closures', () => {
  test('a self-contained closure can be dispatched and worked', async () => {
    ;(globalThis as Record<string, unknown>).__closureRan = false
    const store = new MemoryQueueStore()
    const m = new QueueManager({ default: 'memory', connections: { memory: { driver: 'memory' } } })
    ;(m as unknown as { resolved: Map<string, unknown> }).resolved.set('memory', store)
    await m.push(() => {
      ;(globalThis as Record<string, unknown>).__closureRan = true
    })
    expect(await store.size()).toBe(1)
    await new Worker(store).work({ stopWhenEmpty: true })
    expect((globalThis as Record<string, unknown>).__closureRan).toBe(true)
  })

  test('dispatchSync runs a closure inline', async () => {
    ;(globalThis as Record<string, unknown>).__syncClosureRan = false
    setDefaultQueue(new QueueManager({ default: 'sync' }))
    await dispatchSync(() => {
      ;(globalThis as Record<string, unknown>).__syncClosureRan = true
    })
    expect((globalThis as Record<string, unknown>).__syncClosureRan).toBe(true)
  })
})

// ── global queue events ───────────────────────────────────────────────────────
describe('Queue lifecycle events', () => {
  test('before/after fire for successful jobs, failing for throwing jobs', async () => {
    Queue.clearListeners()
    const before: string[] = []
    const after: string[] = []
    const failing: string[] = []
    Queue.before((n) => void before.push(n))
    Queue.after((n) => void after.push(n))
    Queue.failing((n) => void failing.push(n))

    const store = new MemoryQueueStore()
    await store.push(JSON.stringify(serializeJob(new RecordJob('ok'))))
    await store.push(JSON.stringify(serializeJob(new FlakyJob()))) // tries=3
    await new Worker(store).work({ stopWhenEmpty: true })

    expect(before).toContain('RecordJob')
    expect(after).toEqual(['RecordJob']) // only the successful one
    expect(failing.filter((n) => n === 'FlakyJob')).toHaveLength(3) // one per attempt
    Queue.clearListeners()
  })

  test('bridges to a dispatcher as queue.processing/processed/failed', async () => {
    Queue.clearListeners()
    const dispatched: { name: string; payload: Record<string, unknown> }[] = []
    configureQueueEventDispatcher((name, payload) => void dispatched.push({ name, payload }))

    const store = new MemoryQueueStore()
    await store.push(JSON.stringify(serializeJob(new RecordJob('ok'))))
    await store.push(JSON.stringify(serializeJob(new FlakyJob()))) // tries=3
    await new Worker(store).work({ stopWhenEmpty: true })

    const names = dispatched.map((d) => d.name)
    expect(names).toContain('queue.processing')
    expect(dispatched.find((d) => d.name === 'queue.processed')?.payload).toEqual({ job: 'RecordJob' })
    const failed = dispatched.find((d) => d.name === 'queue.failed')
    expect(failed?.payload.job).toBe('FlakyJob')
    expect(failed?.payload.error).toBeDefined()

    configureQueueEventDispatcher(() => {})
    Queue.clearListeners()
  })
})

// ── chaining ──────────────────────────────────────────────────────────────────
describe('job chaining', () => {
  class ChainJob extends Job {
    constructor(public tag = '') {
      super()
    }
    handle(): void {
      ran.push(this.tag)
    }
  }
  registerJob(ChainJob)

  test('chained jobs run in order after the head succeeds', async () => {
    const store = new MemoryQueueStore()
    const head = new ChainJob('a').chain([new ChainJob('b'), new ChainJob('c')])
    await store.push(JSON.stringify(serializeJob(head)))
    await new Worker(store).work({ stopWhenEmpty: true })
    expect(ran).toEqual(['a', 'b', 'c'])
  })

  test('a failing head does not dispatch the chain', async () => {
    const store = new MemoryQueueStore()
    const head = new FlakyJob().chain([new ChainJob('should-not-run')])
    await store.push(JSON.stringify(serializeJob(head)))
    await new Worker(store).work({ stopWhenEmpty: true })
    expect(ran).toEqual([]) // FlakyJob always throws; chain never fires
  })
})

// ── lifecycle hooks ───────────────────────────────────────────────────────────
describe('worker lifecycle hooks', () => {
  test('onBeforeJob / onAfterJob fire around a successful job', async () => {
    const before: string[] = []
    const after: string[] = []
    const store = new MemoryQueueStore()
    await store.push(JSON.stringify(serializeJob(new RecordJob('x'))))
    await new Worker(store, {
      onBeforeJob: (n) => before.push(n),
      onAfterJob: (n) => after.push(n),
    }).work({ stopWhenEmpty: true })
    expect(before).toEqual(['RecordJob'])
    expect(after).toEqual(['RecordJob'])
  })

  test('onAfterJob does not fire when the job fails', async () => {
    const after: string[] = []
    const store = new MemoryQueueStore()
    await store.push(JSON.stringify(serializeJob(new FlakyJob())))
    await new Worker(store, { onAfterJob: (n) => after.push(n) }).work({ stopWhenEmpty: true })
    expect(after).toEqual([])
  })
})

// ── prune failed ──────────────────────────────────────────────────────────────
describe('prune failed jobs', () => {
  test('removes records older than the cutoff', async () => {
    const adapter = new MemoryFailedJobStore()
    await adapter.log({ id: 'old', connection: 'c', queue: 'q', body: '{}', exception: 'e', failedAt: 1000 })
    await adapter.log({ id: 'fresh', connection: 'c', queue: 'q', body: '{}', exception: 'e', failedAt: Date.now() })
    const removed = await adapter.prune(Date.now() - 3600 * 1000)
    expect(removed).toBe(1)
    expect((await adapter.all()).map((r) => r.id)).toEqual(['fresh'])
  })
})

// ── job middleware ────────────────────────────────────────────────────────────
describe('job middleware', () => {
  test('pipeline runs middleware around handle in order', async () => {
    const trace: string[] = []
    const mw = (tag: string): JobMiddleware => ({
      async handle(_job, next) {
        trace.push(`before:${tag}`)
        await next()
        trace.push(`after:${tag}`)
      },
    })
    class MwJob extends Job {
      override middleware() {
        return [mw('a'), mw('b')]
      }
      handle(): void {
        trace.push('handle')
      }
    }
    await runThroughMiddleware(new MwJob(), () => Promise.resolve(new MwJob().handle()))
    expect(trace).toEqual(['before:a', 'before:b', 'handle', 'after:b', 'after:a'])
  })

  test('a middleware can short-circuit by not calling next', async () => {
    let ran = false
    class GuardJob extends Job {
      override middleware() {
        return [{ handle: async () => {} }] // never calls next
      }
      handle(): void {
        ran = true
      }
    }
    await runThroughMiddleware(new GuardJob(), () => Promise.resolve(new GuardJob().handle()))
    expect(ran).toBe(false)
  })

  test('RateLimited releases the job when over the limit (no attempt burned)', async () => {
    configureRateLimiter(new MemoryRateLimiter())
    class LimitedJob extends Job {
      override tries = 3
      override middleware() {
        return [new RateLimited('emails', { maxAttempts: 1, perSeconds: 3600, releaseAfter: 0 })]
      }
      handle(): void {
        ran.push('limited')
      }
    }
    registerJob(LimitedJob)
    const store = new MemoryQueueStore()
    await store.push(JSON.stringify(serializeJob(new LimitedJob())))
    await store.push(JSON.stringify(serializeJob(new LimitedJob())))

    // process both: first runs (1 hit), second is over-limit → released, not run
    const w = new Worker(store)
    await w.processNext() // runs #1
    const before = await store.size()
    await w.processNext() // #2 over limit → ReleaseJob → back on queue
    expect(ran).toEqual(['limited'])
    expect(await store.size()).toBe(before) // still queued, not failed
  })

  test('ReleaseJob from middleware does not count as a failure', async () => {
    class ReleaseOnceJob extends Job {
      override tries = 1
      static releases = 0
      override middleware() {
        return [
          {
            async handle(_job, next) {
              if (ReleaseOnceJob.releases === 0) {
                ReleaseOnceJob.releases++
                throw new ReleaseJob(0)
              }
              await next()
            },
          } satisfies JobMiddleware,
        ]
      }
      handle(): void {
        ran.push('released-then-ran')
      }
    }
    registerJob(ReleaseOnceJob)
    ReleaseOnceJob.releases = 0
    const store = new MemoryQueueStore()
    await store.push(JSON.stringify(serializeJob(new ReleaseOnceJob())))
    // first attempt released (attempt not burned), second runs despite tries=1
    await new Worker(store).work({ stopWhenEmpty: true })
    expect(ran).toEqual(['released-then-ran'])
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
