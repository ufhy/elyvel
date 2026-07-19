/**
 * A shared lock backing cross-process scheduling (`withoutOverlapping` across
 * workers, `onOneServer`). Back it with a cache (e.g. Redis) via
 * {@link configureScheduleMutex}; without one, locking stays per-process.
 */
export interface ScheduleMutex {
  /** Acquire `key` for `ttlSeconds`; returns false if already held. */
  create(key: string, ttlSeconds: number): Promise<boolean>
  forget(key: string): Promise<void>
}

/** In-memory mutex (per-process; dev/single-server). */
export class MemoryScheduleMutex implements ScheduleMutex {
  private locks = new Map<string, number>() // key → expiry epoch ms
  async create(key: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now()
    const expiry = this.locks.get(key)
    if (expiry !== undefined && expiry > now)
      return false
    this.locks.set(key, now + ttlSeconds * 1000)
    return true
  }

  async forget(key: string): Promise<void> {
    this.locks.delete(key)
  }
}

/** Minimal Redis client (Bun's built-in `RedisClient` satisfies this via `send`). */
export interface RedisLike {
  send(command: string, args: string[]): Promise<unknown>
}

/**
 * Redis-backed mutex — for `withoutOverlapping`/`onOneServer` to actually work
 * across instances. `MemoryScheduleMutex` only locks within a single process,
 * so `.onOneServer()` silently does nothing useful without a shared backend
 * like this one: every instance still thinks it's the only server. Uses
 * `SET key 1 EX ttl NX` (atomic acquire-if-absent), same pattern as
 * `@elyvel/core`'s `RedisRateLimiterStore` and `@elyvel/broadcasting`'s
 * `RedisBroadcaster` — Bun's built-in Redis client, no external dependency.
 */
export class RedisScheduleMutex implements ScheduleMutex {
  constructor(
    private readonly client: RedisLike,
    private readonly prefix = 'schedule-mutex:',
  ) {}

  async create(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.send('SET', [
      this.prefix + key,
      '1',
      'EX',
      String(Math.max(1, Math.ceil(ttlSeconds))),
      'NX',
    ])
    return result === 'OK'
  }

  async forget(key: string): Promise<void> {
    await this.client.send('DEL', [this.prefix + key])
  }
}

let mutex: ScheduleMutex | null = null
export function configureScheduleMutex(store: ScheduleMutex): void {
  mutex = store
}
export function scheduleMutex(): ScheduleMutex | null {
  return mutex
}
