/**
 * A shared lock backing cross-process scheduling (`withoutOverlapping` across
 * workers, `onOneServer`). Back it with a cache (e.g. Redis) via
 * {@link configureScheduleMutex}; without one, locking stays per-process.
 */
export interface ScheduleMutex {
  /**
   * Acquire `key` for `ttlSeconds`; returns false if already held.
   *
   * `token` identifies THIS acquisition. Pass the same token to
   * {@link ScheduleMutex.forget} so a holder whose lock already expired cannot
   * delete the lock a *different* holder has since acquired — see `forget`.
   */
  create(key: string, ttlSeconds: number, token?: string): Promise<boolean>
  /**
   * Release `key`. When `token` is given, release only if `key` is still held
   * by that same acquisition; otherwise this is a no-op.
   *
   * Without the token check, `withoutOverlapping` broke its own guarantee: a
   * task running longer than its TTL let a peer acquire the freed key, and the
   * original holder's `finally` then deleted the PEER's lock — so a third
   * process could start alongside the peer.
   */
  forget(key: string, token?: string): Promise<void>
}

/** In-memory mutex (per-process; dev/single-server). */
export class MemoryScheduleMutex implements ScheduleMutex {
  private locks = new Map<string, { expiry: number, token?: string }>()

  async create(key: string, ttlSeconds: number, token?: string): Promise<boolean> {
    // Read and write with no `await` between them — atomic on Bun's loop.
    const now = Date.now()
    const held = this.locks.get(key)
    if (held !== undefined && held.expiry > now)
      return false
    this.locks.set(key, { expiry: now + ttlSeconds * 1000, token })
    return true
  }

  async forget(key: string, token?: string): Promise<void> {
    const held = this.locks.get(key)
    if (held === undefined)
      return
    // Only the acquisition that still owns the key may release it.
    if (token !== undefined && held.token !== undefined && held.token !== token)
      return
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

  async create(key: string, ttlSeconds: number, token?: string): Promise<boolean> {
    const result = await this.client.send('SET', [
      this.prefix + key,
      token ?? '1',
      'EX',
      String(Math.max(1, Math.ceil(ttlSeconds))),
      'NX',
    ])
    return result === 'OK'
  }

  async forget(key: string, token?: string): Promise<void> {
    if (token === undefined) {
      await this.client.send('DEL', [this.prefix + key])
      return
    }
    // Compare-and-delete in ONE round trip. A separate GET then DEL would
    // reintroduce the very race this guards: the key can expire and be
    // re-acquired by a peer between the two commands, and we'd delete theirs.
    await this.client.send('EVAL', [
      'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
      '1',
      this.prefix + key,
      token,
    ])
  }
}

let mutex: ScheduleMutex | null = null
export function configureScheduleMutex(store: ScheduleMutex): void {
  mutex = store
}
export function scheduleMutex(): ScheduleMutex | null {
  return mutex
}
