import type { RedisLike } from '../src/store'
import { describe, expect, test } from 'bun:test'
import { RedisRateLimiter } from '../src/middleware'

/** Logic-only fake sorted-set Redis — no real server, mirrors other packages' fakes. */
class FakeRedisZSet implements RedisLike {
  private readonly sets = new Map<string, { score: number, member: string }[]>()
  async send(command: string, args: string[]): Promise<unknown> {
    const key = args[0] as string
    const set = this.sets.get(key) ?? []
    switch (command) {
      case 'ZADD':
        set.push({ score: Number(args[1]), member: args[2] as string })
        this.sets.set(key, set)
        return 1
      case 'ZREMRANGEBYSCORE': {
        const max = Number(args[2])
        this.sets.set(key, set.filter(e => e.score > max))
        return 1
      }
      case 'ZCARD':
        return set.length
      case 'EXPIRE':
        return 1
      default:
        return null
    }
  }
}

describe('RedisRateLimiter', () => {
  test('tooManyAttempts is false under the limit, true once hit() reaches it', async () => {
    const rl = new RedisRateLimiter(new FakeRedisZSet())
    expect(await rl.tooManyAttempts('emails', 2)).toBe(false)
    await rl.hit('emails', 3600)
    expect(await rl.tooManyAttempts('emails', 2)).toBe(false)
    await rl.hit('emails', 3600)
    expect(await rl.tooManyAttempts('emails', 2)).toBe(true)
  })

  test('hit() prunes entries older than the decay window', async () => {
    const redis = new FakeRedisZSet()
    const rl = new RedisRateLimiter(redis)
    // Simulate an old hit far outside the window, directly in the fake store.
    await redis.send('ZADD', ['job-rate:emails', String(Date.now() - 10_000), 'stale'])
    await rl.hit('emails', 1) // 1-second window — the stale entry must be pruned
    expect(await rl.tooManyAttempts('emails', 2)).toBe(false) // only the fresh hit remains
  })

  test('two independent limiter instances sharing one Redis agree on the same count', async () => {
    // Simulates two worker processes, each with their own RedisRateLimiter
    // wrapper, both backed by the SAME Redis — proving the count is genuinely
    // shared, not per-instance like MemoryRateLimiter.
    const redis = new FakeRedisZSet()
    const workerA = new RedisRateLimiter(redis)
    const workerB = new RedisRateLimiter(redis)

    await workerA.hit('emails', 3600)
    expect(await workerB.tooManyAttempts('emails', 1)).toBe(true) // B sees A's hit
  })

  test('a custom prefix scopes keys independently', async () => {
    const redis = new FakeRedisZSet()
    const a = new RedisRateLimiter(redis, 'a:')
    const b = new RedisRateLimiter(redis, 'b:')
    await a.hit('k', 3600)
    expect(await b.tooManyAttempts('k', 1)).toBe(false) // different prefix, unaffected
  })
})
