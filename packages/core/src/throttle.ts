import type { MiddlewareContext } from './middleware'
import { trans } from '@elyvel/support'
import { Middleware } from './middleware'

// ── store (injectable) ──────────────────────────────────────────────────────
/**
 * Backing store for the rate limiter. The default is in-memory; back it with a
 * shared cache (redis/database) via {@link configureRateLimiterStore} for
 * cross-process limits. Methods may be sync or async.
 */
export interface RateLimiterStore {
  /** Add `amount` hits within a `decaySeconds` window; returns the new count. */
  increment(key: string, decaySeconds: number, amount?: number): number | Promise<number>
  /** Current hit count for `key` (0 if the window has passed). */
  attempts(key: string): number | Promise<number>
  /** Forget a key. */
  reset(key: string): void | Promise<void>
  /** Seconds until `key`'s window resets (0 if none). */
  availableIn(key: string): number | Promise<number>
}

interface Bucket {
  count: number
  resetAt: number
}

/** In-memory fixed-window store (the zero-config default). */
export class MemoryRateLimiterStore implements RateLimiterStore {
  private readonly buckets = new Map<string, Bucket>()

  increment(key: string, decaySeconds: number, amount = 1): number {
    const now = Date.now()
    const bucket = this.buckets.get(key)
    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(key, { count: amount, resetAt: now + decaySeconds * 1000 })
      return amount
    }
    bucket.count += amount
    return bucket.count
  }

  attempts(key: string): number {
    const bucket = this.buckets.get(key)
    if (!bucket || Date.now() >= bucket.resetAt)
      return 0
    return bucket.count
  }

  reset(key: string): void {
    this.buckets.delete(key)
  }

  availableIn(key: string): number {
    const bucket = this.buckets.get(key)
    if (!bucket)
      return 0
    return Math.max(0, Math.ceil((bucket.resetAt - Date.now()) / 1000))
  }

  clear(): void {
    this.buckets.clear()
  }
}

/** Minimal Redis client (Bun's built-in `RedisClient` satisfies this via `send`). */
export interface RedisLike {
  send(command: string, args: string[]): Promise<unknown>
}

/**
 * Redis-backed rate limiter store — for cross-process/multi-instance limits.
 * `MemoryRateLimiterStore` only tracks hits within a single process, so
 * behind a load balancer each instance enforces the limit independently
 * (3 instances ⇒ an effective 3x limit). Wire it with
 * {@link configureRateLimiterStore}. Uses Bun's built-in Redis client (no
 * external dependency) — same pattern as `@elyvel/queue`'s `RedisQueueStore`
 * and `@elyvel/cache`'s `RedisStore`.
 */
export class RedisRateLimiterStore implements RateLimiterStore {
  constructor(
    private readonly client: RedisLike,
    private readonly prefix = 'throttle:',
  ) {}

  private k(key: string): string {
    return this.prefix + key
  }

  async increment(key: string, decaySeconds: number, amount = 1): Promise<number> {
    const count = Number(await this.client.send('INCRBY', [this.k(key), String(amount)]))
    // Only arm the window on the key's first hit ever — re-arming on every
    // hit would slide the window forward under sustained traffic instead of
    // resetting on a fixed schedule. Once the TTL elapses Redis drops the key
    // itself, so the next increment() naturally starts a fresh window.
    if (count === amount)
      await this.client.send('EXPIRE', [this.k(key), String(Math.max(1, Math.ceil(decaySeconds)))])
    return count
  }

  async attempts(key: string): Promise<number> {
    const raw = await this.client.send('GET', [this.k(key)])
    return raw === null || raw === undefined ? 0 : Number(raw)
  }

  async reset(key: string): Promise<void> {
    await this.client.send('DEL', [this.k(key)])
  }

  async availableIn(key: string): Promise<number> {
    const ttl = Number(await this.client.send('TTL', [this.k(key)]))
    return ttl > 0 ? ttl : 0
  }
}

/** The default in-memory store — also the back-compat `rateLimiter` handle (`.clear()`). */
export const rateLimiter = new MemoryRateLimiterStore()
let store: RateLimiterStore = rateLimiter

/** Swap the backing store (e.g. a cache-backed one). Laravel's `throttleWithRedis` analogue. */
export function configureRateLimiterStore(next: RateLimiterStore): void {
  store = next
}

// ── Limit builder ─────────────────────────────────────────────────────────
type ResponseCallback = (
  ctx: MiddlewareContext,
  headers: Record<string, string | number>,
) => unknown
type AfterCallback = (status: number) => boolean

/** A rate-limit configuration (Laravel's `Illuminate\Cache\RateLimiting\Limit`). */
export class Limit {
  key?: string
  responseCallback?: ResponseCallback
  afterCallback?: AfterCallback

  private constructor(
    readonly maxAttempts: number,
    readonly decaySeconds: number,
    readonly unlimited = false,
  ) {}

  static perSecond(maxAttempts: number, seconds = 1): Limit {
    return new Limit(maxAttempts, seconds)
  }

  static perMinute(maxAttempts: number): Limit {
    return new Limit(maxAttempts, 60)
  }

  static perMinutes(minutes: number, maxAttempts: number): Limit {
    return new Limit(maxAttempts, minutes * 60)
  }

  static perHour(maxAttempts: number, hours = 1): Limit {
    return new Limit(maxAttempts, hours * 3600)
  }

  static perDay(maxAttempts: number, days = 1): Limit {
    return new Limit(maxAttempts, days * 86400)
  }

  static none(): Limit {
    return new Limit(Number.POSITIVE_INFINITY, 60, true)
  }

  /** Segment the limit by an arbitrary value (user id, IP, email…). */
  by(key: string): this {
    this.key = key
    return this
  }

  /** Custom response when the limit is exceeded. */
  response(callback: ResponseCallback): this {
    this.responseCallback = callback
    return this
  }

  /** Only count the request toward the limit when this returns true for the response status. */
  after(callback: AfterCallback): this {
    this.afterCallback = callback
    return this
  }
}

// ── RateLimiter facade ──────────────────────────────────────────────────────
type LimiterResolver = (ctx: MiddlewareContext) => Limit | Limit[] | null | undefined
const limiters = new Map<string, LimiterResolver>()

/**
 * The rate limiter facade (Laravel's `Illuminate\Support\Facades\RateLimiter`).
 * Programmatic attempt/hit/… plus named limiters via {@link RateLimiter.for}
 * that the `throttle:name` middleware resolves.
 */
export const RateLimiter = {
  /** Register a named limiter used by `throttle:name`. */
  for(name: string, resolver: LimiterResolver): void {
    limiters.set(name, resolver)
  },
  /** Look up a named limiter's resolver. */
  limiter(name: string): LimiterResolver | undefined {
    return limiters.get(name)
  },

  async attempts(key: string): Promise<number> {
    return store.attempts(key)
  },
  async increment(key: string, decaySeconds = 60, amount = 1): Promise<number> {
    return store.increment(key, decaySeconds, amount)
  },
  async hit(key: string, decaySeconds = 60): Promise<number> {
    return store.increment(key, decaySeconds, 1)
  },
  async tooManyAttempts(key: string, maxAttempts: number): Promise<boolean> {
    return (await store.attempts(key)) >= maxAttempts
  },
  async remaining(key: string, maxAttempts: number): Promise<number> {
    return Math.max(0, maxAttempts - (await store.attempts(key)))
  },
  async retriesLeft(key: string, maxAttempts: number): Promise<number> {
    return this.remaining(key, maxAttempts)
  },
  async resetAttempts(key: string): Promise<void> {
    await store.reset(key)
  },
  async clear(key: string): Promise<void> {
    await store.reset(key)
  },
  async availableIn(key: string): Promise<number> {
    return store.availableIn(key)
  },

  /**
   * Run `callback` if the key is under its per-`decaySeconds` limit. Returns
   * `false` when rate-limited, otherwise the callback's result (or `true`).
   */
  async attempt<T>(
    key: string,
    maxAttempts: number,
    callback: () => T,
    decaySeconds = 60,
  ): Promise<T | boolean> {
    if (await this.tooManyAttempts(key, maxAttempts))
      return false
    await this.hit(key, decaySeconds)
    const result = callback()
    return result === undefined ? true : result
  },
}

// ── throttle middleware ─────────────────────────────────────────────────────
function clientIp(ctx: MiddlewareContext): string {
  const req = ctx.request
  const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return fwd || req.headers.get('x-real-ip') || 'global'
}

function routeScope(ctx: MiddlewareContext): string {
  const { pathname } = new URL(ctx.request.url)
  return `${ctx.request.method}:${pathname}`
}

/** Deterministic key for a named limiter's i-th limit (same in handle + terminate). */
function limitKey(name: string, index: number, ctx: MiddlewareContext, limit: Limit): string {
  return `throttle:${name}:${index}:${limit.key ?? clientIp(ctx)}`
}

function setRateHeaders(ctx: MiddlewareContext, max: number, count: number): void {
  ctx.set.headers['x-ratelimit-limit'] = String(max)
  ctx.set.headers['x-ratelimit-remaining'] = String(Math.max(0, max - count))
}

/**
 * `throttle:name` — evaluate a named limiter (see {@link RateLimiter.for}), or
 * `throttle:max,decayMinutes` — a simple per-client (IP) window. Sets
 * `X-RateLimit-*`, returns 429 with `Retry-After` (or a Limit's custom response)
 * when exceeded. A Limit's `.after()` defers counting to the response status.
 */
export class ThrottleMiddleware extends Middleware {
  async handle(ctx: MiddlewareContext, ...args: string[]): Promise<unknown> {
    const name = args[0]
    const resolver = name ? RateLimiter.limiter(name) : undefined
    if (resolver)
      return this.handleNamed(ctx, name as string, resolver)
    return this.handleInline(ctx, args[0] ?? '60', args[1] ?? '1')
  }

  private async handleInline(
    ctx: MiddlewareContext,
    max: string,
    decayMinutes: string,
  ): Promise<unknown> {
    const limit = Number(max)
    const decaySeconds = Number(decayMinutes) * 60
    const key = `${routeScope(ctx)}:${clientIp(ctx)}`
    const count = await store.increment(key, decaySeconds, 1)
    setRateHeaders(ctx, limit, count)
    if (count > limit) {
      ctx.set.headers['retry-after'] = String(await store.availableIn(key))
      return ctx.status(429, { message: trans('errors.throttle', {}, 'Too Many Requests') })
    }
  }

  private async handleNamed(
    ctx: MiddlewareContext,
    name: string,
    resolver: LimiterResolver,
  ): Promise<unknown> {
    const resolved = resolver(ctx)
    if (!resolved)
      return
    const limits = Array.isArray(resolved) ? resolved : [resolved]

    for (let i = 0; i < limits.length; i++) {
      const limit = limits[i]
      if (!limit || limit.unlimited)
        continue
      const key = limitKey(name, i, ctx, limit)

      // `.after()` limits count based on the response — only check here.
      if (limit.afterCallback) {
        if (await RateLimiter.tooManyAttempts(key, limit.maxAttempts))
          return this.reject(ctx, limit, key)
        continue
      }

      const count = await store.increment(key, limit.decaySeconds, 1)
      setRateHeaders(ctx, limit.maxAttempts, count)
      if (count > limit.maxAttempts)
        return this.reject(ctx, limit, key)
    }
  }

  private async reject(ctx: MiddlewareContext, limit: Limit, key: string): Promise<unknown> {
    ctx.set.headers['x-ratelimit-limit'] = String(limit.maxAttempts)
    ctx.set.headers['x-ratelimit-remaining'] = '0'
    ctx.set.headers['retry-after'] = String(await store.availableIn(key))
    if (limit.responseCallback)
      return limit.responseCallback(ctx, ctx.set.headers)
    return ctx.status(429, { message: trans('errors.throttle', {}, 'Too Many Requests') })
  }

  /** Response-based counting for `.after()` limits — increment only when it opts in. */
  override async terminate(ctx: MiddlewareContext, ...args: string[]): Promise<void> {
    const name = args[0]
    if (!name)
      return
    const resolver = RateLimiter.limiter(name)
    if (!resolver)
      return
    const resolved = resolver(ctx)
    if (!resolved)
      return
    const limits = Array.isArray(resolved) ? resolved : [resolved]
    const status = Number(ctx.set.status ?? 200)

    for (let i = 0; i < limits.length; i++) {
      const limit = limits[i]
      if (!limit || limit.unlimited || !limit.afterCallback)
        continue
      if (limit.afterCallback(status))
        await store.increment(limitKey(name, i, ctx, limit), limit.decaySeconds, 1)
    }
  }
}
