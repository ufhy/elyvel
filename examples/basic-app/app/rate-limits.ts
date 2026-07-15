import { cache } from '@elysia-ravel/cache'
import {
  configureRateLimiterStore,
  Limit,
  RateLimiter,
  type RateLimiterStore,
} from '@elysia-ravel/core'

/**
 * A cache-backed rate limiter store — the limits live in the shared cache
 * (memory/database/redis per config/cache.ts), so they hold across processes.
 * Mirrors Laravel's cache-based RateLimiter (a counter + an expiry "timer" key).
 */
class CacheRateLimiterStore implements RateLimiterStore {
  private repo() {
    return cache()
  }

  async increment(key: string, decaySeconds: number, amount = 1): Promise<number> {
    const fresh = await this.repo().add(
      `${key}:timer`,
      Date.now() + decaySeconds * 1000,
      decaySeconds,
    )
    if (fresh) await this.repo().put(key, 0, decaySeconds)
    return this.repo().increment(key, amount)
  }
  async attempts(key: string): Promise<number> {
    return Number(await this.repo().get(key, 0))
  }
  async reset(key: string): Promise<void> {
    await this.repo().forget(key)
    await this.repo().forget(`${key}:timer`)
  }
  async availableIn(key: string): Promise<number> {
    const timer = Number(await this.repo().get(`${key}:timer`, 0))
    return timer ? Math.max(0, Math.ceil((timer - Date.now()) / 1000)) : 0
  }
}

/** Back the rate limiter with the cache + register named limiters (Laravel's RateLimiter::for). */
export function configureRateLimits(): void {
  configureRateLimiterStore(new CacheRateLimiterStore())

  // `throttle:api` — 3 requests/min per client IP (the default keying).
  RateLimiter.for('api', () => Limit.perMinute(3))

  // `throttle:login` — 100/min overall, but only 2/min per email (segmented).
  RateLimiter.for('login', (ctx) => [
    Limit.perMinute(100),
    Limit.perMinute(2).by(`email:${(ctx.query as Record<string, string>).email ?? 'anon'}`),
  ])
}
