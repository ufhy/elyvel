import { beforeEach, describe, expect, test } from 'bun:test'
import { dispatch, dispatchSync, QueueManager, setDefaultQueue } from '../src/manager'
import { Job, registerJob, reconstructJob, serializeJob } from '../src/job'
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

registerJob(RecordJob, FlakyJob)

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
    const job = reconstructJob(s.job, s.data, s.tries)
    expect(job).toBeInstanceOf(RecordJob)
    job.handle()
    expect(ran).toEqual(['hello'])
  })

  test('reconstruct throws for unknown job', () => {
    expect(() => reconstructJob('Nope', {}, 1)).toThrow(/Unknown job "Nope"/)
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
    await store.push(JSON.stringify(serializeJob(new RecordJob('soon'))), 3600)
    expect(await store.pop()).toBeNull()
    expect(await store.size()).toBe(1)
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
    const rows: { id: string; body: string; attempts: number; availableAt: number }[] = []
    const adapter: QueueDbAdapter = {
      insert: async (id, body, attempts, availableAt) => {
        rows.push({ id, body, attempts, availableAt })
      },
      takeReady: async (now) => {
        const ready = rows.filter((r) => r.availableAt <= now).sort((a, b) => a.availableAt - b.availableAt)
        const next = ready[0]
        if (!next) return null
        rows.splice(rows.indexOf(next), 1)
        return { id: next.id, body: next.body, attempts: next.attempts }
      },
      count: async () => rows.length,
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
