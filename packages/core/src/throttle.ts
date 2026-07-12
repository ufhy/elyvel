import { Middleware, type MiddlewareContext } from './middleware'

interface Bucket {
  count: number
  resetAt: number
}

/** In-memory fixed-window rate limiter. Keyed by an arbitrary string. */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>()

  /** Record a hit. Returns remaining allowance and reset time. */
  hit(key: string, max: number, windowMs: number, now: number) {
    const bucket = this.buckets.get(key)
    if (!bucket || now >= bucket.resetAt) {
      const fresh = { count: 1, resetAt: now + windowMs }
      this.buckets.set(key, fresh)
      return { allowed: true, remaining: max - 1, resetAt: fresh.resetAt }
    }
    bucket.count += 1
    const allowed = bucket.count <= max
    return { allowed, remaining: Math.max(0, max - bucket.count), resetAt: bucket.resetAt }
  }

  clear(): void {
    this.buckets.clear()
  }
}

/** Shared limiter used by the built-in `throttle` middleware. */
export const rateLimiter = new RateLimiter()

function clientKey(ctx: MiddlewareContext): string {
  const req = ctx.request
  const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = fwd || req.headers.get('x-real-ip') || 'global'
  const { pathname } = new URL(req.url)
  return `${req.method}:${pathname}:${ip}`
}

/**
 * `throttle:max,decayMinutes` — limit requests per client (IP) within a window.
 * Registered as a built-in alias, so `{ middleware: 'throttle:60,1' }` works out
 * of the box (60 requests per 1 minute). Sets `X-RateLimit-*` headers; returns
 * 429 with `Retry-After` when exceeded.
 */
export class ThrottleMiddleware extends Middleware {
  handle(ctx: MiddlewareContext, max = '60', decayMinutes = '1') {
    const limit = Number(max)
    const windowMs = Number(decayMinutes) * 60_000
    const now = Date.now()
    const { allowed, remaining, resetAt } = rateLimiter.hit(clientKey(ctx), limit, windowMs, now)

    ctx.set.headers['x-ratelimit-limit'] = String(limit)
    ctx.set.headers['x-ratelimit-remaining'] = String(remaining)

    if (!allowed) {
      const retryAfter = Math.ceil((resetAt - now) / 1000)
      ctx.set.headers['retry-after'] = String(retryAfter)
      return ctx.status(429, { message: 'Too Many Requests' })
    }
  }
}
