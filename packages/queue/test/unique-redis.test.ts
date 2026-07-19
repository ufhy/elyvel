import type { RedisLike } from '../src/store'
import { describe, expect, test } from 'bun:test'
import { RedisUniqueLock } from '../src/unique'

/** Logic-only fake — no real Redis server, mirrors other packages' Redis fakes. */
class FakeRedis implements RedisLike {
  private readonly values = new Map<string, string>()
  async send(command: string, args: string[]): Promise<unknown> {
    const [key] = args
    switch (command) {
      case 'SET': {
        const nx = args.includes('NX')
        if (nx && this.values.has(key as string))
          return null
        this.values.set(key as string, args[1] as string)
        return 'OK'
      }
      case 'DEL':
        this.values.delete(key as string)
        return 1
      default:
        return null
    }
  }
}

describe('RedisUniqueLock', () => {
  test('acquire() locks an unheld key, fails while it\'s still held', async () => {
    const lock = new RedisUniqueLock(new FakeRedis())
    expect(await lock.acquire('job:1', 60)).toBe(true)
    expect(await lock.acquire('job:1', 60)).toBe(false)
  })

  test('release() lets the key be re-acquired', async () => {
    const lock = new RedisUniqueLock(new FakeRedis())
    await lock.acquire('job:1', 60)
    await lock.release('job:1')
    expect(await lock.acquire('job:1', 60)).toBe(true)
  })

  test('two independent lock instances sharing one Redis — only one worker wins', async () => {
    // Simulates two worker processes, each with their own RedisUniqueLock
    // wrapper, both backed by the SAME Redis — proving the lock is genuinely
    // shared, not per-instance like MemoryUniqueLock.
    const redis = new FakeRedis()
    const workerA = new RedisUniqueLock(redis)
    const workerB = new RedisUniqueLock(redis)

    expect(await workerA.acquire('unique:ReportJob:2026-07-19', 3600)).toBe(true)
    expect(await workerB.acquire('unique:ReportJob:2026-07-19', 3600)).toBe(false)
  })
})
