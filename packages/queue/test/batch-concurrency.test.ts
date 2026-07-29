import type { RedisLike } from '../src/store'
import { beforeEach, describe, expect, test } from 'bun:test'
import { configureBatches, recordBatchedJob, RedisBatchStore } from '../src/batch'

/** Logic-only fake, faithful on what matters: SET NX refuses, DECRBY/INCR reply with the new value. */
class FakeRedis implements RedisLike {
  private readonly kv = new Map<string, string>()
  async send(command: string, args: string[]): Promise<unknown> {
    const key = args[0] as string
    switch (command) {
      case 'SET':
        if (args.includes('NX') && this.kv.has(key))
          return null
        this.kv.set(key, args[1] as string)
        return 'OK'
      case 'GET':
        return this.kv.get(key) ?? null
      case 'DECRBY': {
        const next = Number(this.kv.get(key) ?? 0) - Number(args[1])
        this.kv.set(key, String(next))
        return next
      }
      case 'INCR': {
        const next = Number(this.kv.get(key) ?? 0) + 1
        this.kv.set(key, String(next))
        return next
      }
      default:
        return null
    }
  }
}

// Batch callbacks are stored as source and re-evaluated, so they can't close
// over a local — record through a global instead.
function ran(): string[] {
  return (globalThis as unknown as { __batchCalls: string[] }).__batchCalls
}

async function seed(allowFailures: boolean, pending = 2) {
  ;(globalThis as unknown as { __batchCalls: string[] }).__batchCalls = []
  const store = new RedisBatchStore(new FakeRedis())
  configureBatches(store)
  await store.create({
    id: 'b1',
    name: 'batch',
    total: pending,
    pending,
    failed: 0,
    allowFailures,
    cancelledAt: null,
    finishedAt: null,
    onThen: '() => globalThis.__batchCalls.push("then")',
    onCatch: '() => globalThis.__batchCalls.push("catch")',
    onFinally: '() => globalThis.__batchCalls.push("finally")',
  } as never)
  return store
}

// Regression: `recordJobResult` did DECRBY then a SEPARATE `find()`, so the
// returned counters weren't the atomic result. Two workers finishing at the
// same moment both read pending 0 and both ran then+finally; two failing at
// once both read `failed` already past 1, so the `failed === 1` test was false
// for both and the batch was never cancelled — `catch` never ran.
describe('batch settles exactly once under concurrent workers', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { __batchCalls: string[] }).__batchCalls = []
  })

  test('two jobs succeeding simultaneously run then + finally once each', async () => {
    await seed(true)
    await Promise.all([recordBatchedJob('b1', true), recordBatchedJob('b1', true)])
    expect(ran()).toEqual(['then', 'finally'])
  })

  test('two jobs failing simultaneously run catch exactly once', async () => {
    await seed(false)
    await Promise.all([
      recordBatchedJob('b1', false, new Error('a')),
      recordBatchedJob('b1', false, new Error('b')),
    ])
    expect(ran().filter(c => c === 'catch')).toHaveLength(1)
  })

  test('a cancelled batch still settles, and does not claim success', async () => {
    // Dropped jobs used to return without being recorded, so `pending` never
    // reached zero and `finally` never ran.
    const store = await seed(false, 2)
    await store.cancel('b1')
    await recordBatchedJob('b1', true) // a job dropped because of the cancel
    await recordBatchedJob('b1', true)
    expect(ran()).toContain('finally')
    expect(ran()).not.toContain('then') // cancelled is never "all succeeded"
  })
})
