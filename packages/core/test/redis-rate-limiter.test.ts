import { describe, expect, test } from 'bun:test'
import { RedisRateLimiterStore } from '../src/throttle'

/** Logic-only fake — no real Redis server, mirrors @elyvel/cache's test fake. */
class FakeRedis {
  readonly values = new Map<string, string>()
  readonly ttls = new Map<string, number>()
  calls: { command: string, args: string[] }[] = []

  async send(command: string, args: string[]): Promise<unknown> {
    this.calls.push({ command, args })
    const [key] = args
    switch (command) {
      case 'INCRBY': {
        const n = Number(this.values.get(key as string) ?? 0) + Number(args[1])
        this.values.set(key as string, String(n))
        return n
      }
      case 'EXPIRE':
        this.ttls.set(key as string, Number(args[1]))
        return 1
      case 'GET':
        return this.values.get(key as string) ?? null
      case 'DEL':
        this.values.delete(key as string)
        this.ttls.delete(key as string)
        return 1
      case 'TTL':
        return this.ttls.get(key as string) ?? -1
      default:
        return null
    }
  }

  /** Simulate the window elapsing — Redis itself drops the key once its TTL hits 0. */
  expireNow(key: string): void {
    this.values.delete(key)
    this.ttls.delete(key)
  }
}

describe('RedisRateLimiterStore', () => {
  test('increment arms the window (EXPIRE) only on the first hit', async () => {
    const redis = new FakeRedis()
    const store = new RedisRateLimiterStore(redis)

    expect(await store.increment('login', 60)).toBe(1)
    expect(await store.increment('login', 60)).toBe(2)
    expect(await store.increment('login', 60)).toBe(3)

    const expireCalls = redis.calls.filter(c => c.command === 'EXPIRE')
    expect(expireCalls).toHaveLength(1) // armed once, not re-armed on every hit
    expect(expireCalls[0]?.args).toEqual(['throttle:login', '60'])
  })

  test('attempts() reflects the current count; 0 for an unknown key', async () => {
    const store = new RedisRateLimiterStore(new FakeRedis())
    expect(await store.attempts('nope')).toBe(0)
    await store.increment('seen', 60, 3)
    expect(await store.attempts('seen')).toBe(3)
  })

  test('reset() clears both the count and its TTL', async () => {
    const redis = new FakeRedis()
    const store = new RedisRateLimiterStore(redis)
    await store.increment('k', 60)
    await store.reset('k')
    expect(await store.attempts('k')).toBe(0)
    expect(await store.availableIn('k')).toBe(0)
  })

  test('availableIn() surfaces the Redis TTL, 0 when unset/expired', async () => {
    const store = new RedisRateLimiterStore(new FakeRedis())
    expect(await store.availableIn('never-hit')).toBe(0)
    await store.increment('k', 30)
    expect(await store.availableIn('k')).toBe(30)
  })

  test('once the window elapses (key drops out of Redis), the next hit starts fresh', async () => {
    const redis = new FakeRedis()
    const store = new RedisRateLimiterStore(redis)
    await store.increment('k', 1)
    await store.increment('k', 1)
    expect(await store.attempts('k')).toBe(2)

    redis.expireNow('throttle:k') // simulate Redis's own TTL eviction
    expect(await store.increment('k', 1)).toBe(1) // fresh window, not 3
  })

  test('a custom prefix is applied to every key', async () => {
    const redis = new FakeRedis()
    const store = new RedisRateLimiterStore(redis, 'rl:')
    await store.increment('a', 60)
    expect(redis.values.has('rl:a')).toBe(true)
  })
})
