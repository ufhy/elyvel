import { describe, expect, test } from 'bun:test'
import { RedisScheduleMutex } from '../src/mutex'

/** Logic-only fake — no real Redis server, mirrors other packages' Redis fakes. */
class FakeRedis {
  private readonly values = new Map<string, string>()

  async send(command: string, args: string[]): Promise<unknown> {
    const [key] = args
    switch (command) {
      case 'SET': {
        const nx = args.includes('NX')
        if (nx && this.values.has(key as string))
          return null // NX: already set, SET is a no-op
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

describe('RedisScheduleMutex', () => {
  test('create() acquires an unheld key, fails while it\'s still held', async () => {
    const mutex = new RedisScheduleMutex(new FakeRedis())
    expect(await mutex.create('oneserver:report:123', 60)).toBe(true)
    expect(await mutex.create('oneserver:report:123', 60)).toBe(false) // still held
  })

  test('forget() releases the lock so it can be re-acquired', async () => {
    const mutex = new RedisScheduleMutex(new FakeRedis())
    await mutex.create('k', 60)
    await mutex.forget('k')
    expect(await mutex.create('k', 60)).toBe(true)
  })

  test('a custom prefix is applied to every key', async () => {
    const redis = new FakeRedis()
    const mutex = new RedisScheduleMutex(redis, 'sched:')
    await mutex.create('a', 60)
    // Acquiring the SAME logical key through a store with the default prefix
    // must not collide — proves the prefix actually scopes the key.
    const other = new RedisScheduleMutex(redis)
    expect(await other.create('a', 60)).toBe(true)
  })

  test('two independent mutex instances sharing one Redis only let one claim the lock', async () => {
    // Simulates two server instances, each with their own RedisScheduleMutex
    // wrapper, both backed by the SAME Redis — proving the lock is genuinely
    // shared, not per-instance like MemoryScheduleMutex.
    const redis = new FakeRedis()
    const serverA = new RedisScheduleMutex(redis)
    const serverB = new RedisScheduleMutex(redis)

    const claimedByA = await serverA.create('oneserver:job:1', 60)
    const claimedByB = await serverB.create('oneserver:job:1', 60)

    expect(claimedByA).toBe(true)
    expect(claimedByB).toBe(false)
  })
})
