import type { Job } from './job'
import type { RedisLike } from './store'
import { randomUUID } from 'node:crypto'
import { uniqueLock } from './unique'

/**
 * Job middleware wraps `handle()` — like HTTP middleware for jobs. Implement
 * `handle(job, next)` and call `next()` to proceed (or skip it to short-circuit).
 * A job exposes its middleware via `middleware(): JobMiddleware[]`.
 */
export interface JobMiddleware {
  handle(job: Job, next: () => Promise<void>): Promise<void>
}

/**
 * Thrown by middleware to put the job back on the queue without counting it as
 * a failed attempt (à la Laravel's `$job->release()`). The worker catches it.
 */
export class ReleaseJob {
  constructor(public readonly delaySeconds: number = 0) {}
}

/** Run a job's `handle()` through its middleware pipeline. */
export async function runThroughMiddleware(job: Job, core: () => Promise<void>): Promise<void> {
  const middleware = job.middleware ? job.middleware() : []
  let next = core
  for (let i = middleware.length - 1; i >= 0; i--) {
    const mw = middleware[i] as JobMiddleware
    const downstream = next
    next = () => mw.handle(job, downstream)
  }
  await next()
}

/**
 * Ensures only one job holding the same key runs at a time (Laravel's
 * `WithoutOverlapping`). Uses the lock configured via `configureUniqueJobs`;
 * if none is set, the job runs without locking. On contention the job is
 * released back to the queue after `releaseAfter` seconds.
 */
export class WithoutOverlapping implements JobMiddleware {
  constructor(
    private readonly key: string,
    private readonly options: { releaseAfter?: number, expireAfter?: number } = {},
  ) {}

  async handle(_job: Job, next: () => Promise<void>): Promise<void> {
    const lock = uniqueLock()
    if (!lock) {
      await next()
      return
    }
    const lockKey = `overlap:${this.key}`
    const acquired = await lock.acquire(lockKey, this.options.expireAfter ?? 60)
    if (!acquired)
      throw new ReleaseJob(this.options.releaseAfter ?? 0)
    try {
      await next()
    }
    finally {
      await lock.release(lockKey)
    }
  }
}

/** Sliding-window rate limiter backing {@link RateLimited}. */
export interface RateLimiter {
  /** Has `key` reached `maxAttempts` within its window? */
  tooManyAttempts(key: string, maxAttempts: number): Promise<boolean>
  /** Record a hit against `key`, expiring after `decaySeconds`. */
  hit(key: string, decaySeconds: number): Promise<void>
}

/** In-memory rate limiter (per-process; dev/tests). */
export class MemoryRateLimiter implements RateLimiter {
  private hits = new Map<string, number[]>() // key → hit timestamps (ms)
  async tooManyAttempts(key: string, maxAttempts: number): Promise<boolean> {
    return (this.hits.get(key)?.length ?? 0) >= maxAttempts
  }

  async hit(key: string, decaySeconds: number): Promise<void> {
    const now = Date.now()
    const cutoff = now - decaySeconds * 1000
    const kept = (this.hits.get(key) ?? []).filter(t => t > cutoff)
    kept.push(now)
    this.hits.set(key, kept)
  }
}

/**
 * Redis-backed sliding-window rate limiter — makes `RateLimited` actually
 * limit across worker processes. `MemoryRateLimiter` only tracks hits within
 * a single process, so N worker processes each enforce `maxAttempts`
 * independently (N processes ⇒ an effective Nx limit) — same bug class as
 * the rate limiter/broadcaster/scheduler-mutex/restart-signal/unique-job-lock
 * gaps fixed elsewhere this session. Uses a Redis sorted set (score = hit
 * timestamp) — same sliding-window shape as `MemoryRateLimiter`, including
 * its same imprecision: `tooManyAttempts` reports the set's current
 * cardinality without pruning (pruning happens in `hit()`, matching the
 * in-memory implementation's behavior exactly).
 */
export class RedisRateLimiter implements RateLimiter {
  constructor(
    private readonly client: RedisLike,
    private readonly prefix = 'job-rate:',
  ) {}

  private key(key: string): string {
    return this.prefix + key
  }

  async tooManyAttempts(key: string, maxAttempts: number): Promise<boolean> {
    const count = Number(await this.client.send('ZCARD', [this.key(key)]))
    return count >= maxAttempts
  }

  async hit(key: string, decaySeconds: number): Promise<void> {
    const redisKey = this.key(key)
    const now = Date.now()
    const cutoff = now - decaySeconds * 1000
    await this.client.send('ZREMRANGEBYSCORE', [redisKey, '-inf', String(cutoff)])
    await this.client.send('ZADD', [redisKey, String(now), `${now}:${randomUUID()}`])
    await this.client.send('EXPIRE', [redisKey, String(Math.max(1, Math.ceil(decaySeconds)))])
  }
}

let limiter: RateLimiter | null = null
/** Wire the limiter backing {@link RateLimited}. Without it, RateLimited is a no-op. */
export function configureRateLimiter(store: RateLimiter): void {
  limiter = store
}
export function rateLimiter(): RateLimiter | null {
  return limiter
}

/**
 * Allows at most `maxAttempts` runs per `perSeconds` for a key (Laravel's
 * `RateLimited`). Over the limit, the job is released back after `releaseAfter`
 * seconds. Requires {@link configureRateLimiter}; otherwise it runs unthrottled.
 */
export class RateLimited implements JobMiddleware {
  constructor(
    private readonly key: string,
    private readonly options: { maxAttempts: number, perSeconds: number, releaseAfter?: number },
  ) {}

  async handle(_job: Job, next: () => Promise<void>): Promise<void> {
    const rl = rateLimiter()
    if (!rl) {
      await next()
      return
    }
    const key = `rate:${this.key}`
    if (await rl.tooManyAttempts(key, this.options.maxAttempts)) {
      throw new ReleaseJob(this.options.releaseAfter ?? this.options.perSeconds)
    }
    await rl.hit(key, this.options.perSeconds)
    await next()
  }
}
