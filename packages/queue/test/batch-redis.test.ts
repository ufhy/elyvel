import type { BatchRecord } from '../src/batch'
import type { RedisLike } from '../src/store'
import { describe, expect, test } from 'bun:test'
import { RedisBatchStore } from '../src/batch'

/** Logic-only fake — no real Redis server, mirrors other packages' Redis fakes. */
class FakeRedis implements RedisLike {
  private readonly values = new Map<string, string>()
  async send(command: string, args: string[]): Promise<unknown> {
    const [key] = args
    switch (command) {
      case 'GET':
        return this.values.get(key as string) ?? null
      case 'SET':
        this.values.set(key as string, args[1] as string)
        return 'OK'
      case 'INCR': {
        const n = Number(this.values.get(key as string) ?? 0) + 1
        this.values.set(key as string, String(n))
        return n
      }
      case 'DECRBY': {
        const n = Number(this.values.get(key as string) ?? 0) - Number(args[1])
        this.values.set(key as string, String(n))
        return n
      }
      default:
        return null
    }
  }
}

function record(overrides: Partial<BatchRecord> = {}): BatchRecord {
  return {
    id: 'b1',
    name: 'imports',
    total: 3,
    pending: 3,
    failed: 0,
    allowFailures: false,
    cancelledAt: null,
    finishedAt: null,
    createdAt: Date.now(),
    ...overrides,
  }
}

describe('RedisBatchStore', () => {
  test('create() then find() round-trips the record', async () => {
    const store = new RedisBatchStore(new FakeRedis())
    const rec = record()
    await store.create(rec)
    expect(await store.find('b1')).toEqual(rec)
  })

  test('find() returns null for an unknown id', async () => {
    const store = new RedisBatchStore(new FakeRedis())
    expect(await store.find('nope')).toBeNull()
  })

  test('recordJobResult atomically decrements pending, increments failed on !success', async () => {
    const store = new RedisBatchStore(new FakeRedis())
    await store.create(record())

    const afterSuccess = await store.recordJobResult('b1', true)
    expect(afterSuccess?.pending).toBe(2)
    expect(afterSuccess?.failed).toBe(0)

    const afterFailure = await store.recordJobResult('b1', false)
    expect(afterFailure?.pending).toBe(1)
    expect(afterFailure?.failed).toBe(1)
  })

  test('recordJobResult on an unknown id returns null', async () => {
    const store = new RedisBatchStore(new FakeRedis())
    expect(await store.recordJobResult('nope', true)).toBeNull()
  })

  test('cancel()/markFinished() set their timestamps', async () => {
    const store = new RedisBatchStore(new FakeRedis())
    await store.create(record())
    expect((await store.find('b1'))?.cancelledAt).toBeNull()
    await store.cancel('b1')
    expect((await store.find('b1'))?.cancelledAt).toBeGreaterThan(0)

    expect((await store.find('b1'))?.finishedAt).toBeNull()
    await store.markFinished('b1')
    expect((await store.find('b1'))?.finishedAt).toBeGreaterThan(0)
  })

  test('two independent store instances sharing one Redis see the same batch progress', async () => {
    // Simulates two worker processes, each with their own RedisBatchStore
    // wrapper, both backed by the SAME Redis — proving state is genuinely
    // shared, not per-instance like MemoryBatchStore.
    const redis = new FakeRedis()
    const workerA = new RedisBatchStore(redis)
    const workerB = new RedisBatchStore(redis)

    await workerA.create(record({ total: 2, pending: 2 }))
    await workerA.recordJobResult('b1', true) // job 1 finishes on worker A
    const seenByB = await workerB.recordJobResult('b1', true) // job 2 finishes on worker B
    expect(seenByB?.pending).toBe(0) // B's decrement stacked on A's, not a fresh 2-1
  })
})
