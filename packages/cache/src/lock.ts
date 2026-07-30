import type { CacheStore } from './store'

/** Thrown by {@link Lock.block} when the lock could not be acquired in time. */
export class LockTimeoutError extends Error {
  constructor(readonly lockName: string, readonly waitedSeconds: number) {
    super(`[elyvel] Timed out after ${waitedSeconds}s waiting for the lock "${lockName}".`)
    this.name = 'LockTimeoutError'
  }
}

/** A store that can back locks — see `CacheStore.add`/`CacheStore.forgetIf`. */
type LockCapableStore = CacheStore
  & Required<Pick<CacheStore, 'add' | 'forgetIf'>>

/** Can this store back a lock? Both primitives have to be atomic to be safe. */
export function supportsLocks(store: CacheStore): store is LockCapableStore {
  return typeof store.add === 'function' && typeof store.forgetIf === 'function'
}

/**
 * A mutually-exclusive, owner-checked lock — Laravel's `Cache::lock()`.
 *
 * ```ts
 * const lock = cache().lock('import-feed', 120)
 * if (await lock.acquire()) {
 *   try { await importFeed() }
 *   finally { await lock.release() }
 * }
 * ```
 *
 * Or let it manage the release for you, which is the form to prefer — the
 * callback shape can't leak the lock on an early return or a throw:
 *
 * ```ts
 * await cache().lock('import-feed', 120).acquire(() => importFeed())
 * ```
 *
 * **Ownership is the point.** Every acquisition stores a random owner token, and
 * `release()` deletes the key only if that token is still there. A holder whose
 * TTL lapsed mid-work therefore cannot release a lock a peer has since taken —
 * without that check, releasing would hand the lock to a third caller while the
 * peer still believed it held it. That bug existed in this framework's own
 * scheduler mutex; this class is the shared, tested version of the primitive.
 *
 * **A TTL is mandatory, not optional.** A lock whose holder crashes must expire
 * on its own or it wedges the operation forever. Set it comfortably longer than
 * the work, and treat expiry as "my work took longer than I promised", not as a
 * safety net.
 */
export class Lock {
  private readonly token: string

  constructor(
    private readonly store: LockCapableStore,
    readonly name: string,
    /** How long the lock survives before expiring on its own. */
    readonly seconds: number = 60,
    owner?: string,
  ) {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new RangeError(
        `[elyvel] The lock "${name}" needs a positive TTL in seconds — a lock that `
        + 'never expires wedges the operation permanently if its holder crashes.',
      )
    }
    this.token = owner ?? crypto.randomUUID()
  }

  /** This acquisition's token — pass it to `restoreLock()` in another process. */
  owner(): string {
    return this.token
  }

  /** The key the lock occupies in the cache. */
  private get key(): string {
    return `elyvel:lock:${this.name}`
  }

  /**
   * Take the lock if it's free. Returns whether we got it — it does NOT wait; use
   * {@link block} for that.
   *
   * With a callback, the lock is released automatically when the callback settles
   * (including on a throw), and the return value is the callback's result — or
   * `false` when the lock wasn't free, so `false` is distinguishable from a
   * callback that returned nothing.
   */
  async acquire(): Promise<boolean>
  async acquire<T>(callback: () => T | Promise<T>): Promise<T | false>
  async acquire<T>(callback?: () => T | Promise<T>): Promise<boolean | T | false> {
    const got = await this.store.add(this.key, this.token, this.seconds)
    if (!callback)
      return got
    if (!got)
      return false
    try {
      return await callback()
    }
    finally {
      await this.release()
    }
  }

  /** Laravel spells {@link acquire} `get()`; kept so ported code reads the same. */
  async get(): Promise<boolean>
  async get<T>(callback: () => T | Promise<T>): Promise<T | false>
  async get<T>(callback?: () => T | Promise<T>): Promise<boolean | T | false> {
    return callback ? this.acquire(callback) : this.acquire()
  }

  /**
   * Wait up to `waitSeconds` for the lock, polling until it frees up. Throws
   * {@link LockTimeoutError} if it never does — a timeout is a real outcome the
   * caller must handle, not a `false` that's easy to drop on the floor.
   *
   * With a callback the lock is released automatically, as in {@link acquire}.
   */
  async block(waitSeconds: number): Promise<true>
  async block<T>(waitSeconds: number, callback: () => T | Promise<T>): Promise<T>
  async block<T>(waitSeconds: number, callback?: () => T | Promise<T>): Promise<true | T> {
    const deadline = Date.now() + waitSeconds * 1000
    // Poll rather than subscribe: every backend here can do an atomic add, but
    // none of them can notify. 100ms trades a little latency for not hammering a
    // shared Redis/DB while several workers queue on the same key.
    const intervalMs = 100
    for (;;) {
      if (await this.acquire()) {
        if (!callback)
          return true
        try {
          return await callback()
        }
        finally {
          await this.release()
        }
      }
      if (Date.now() + intervalMs > deadline)
        throw new LockTimeoutError(this.name, waitSeconds)
      await Bun.sleep(intervalMs)
    }
  }

  /**
   * Release the lock, but only if we still hold it. Returns `false` when we
   * don't — meaning our TTL lapsed and someone else has it, which is worth
   * logging: the work outlived the lock it was supposed to be protected by.
   */
  async release(): Promise<boolean> {
    return this.store.forgetIf(this.key, this.token)
  }

  /**
   * Release regardless of owner. This is a foot-gun by design — it will happily
   * yank a lock another process is actively relying on. Reserve it for clearing a
   * lock stranded by a crash, where you've established nobody holds it.
   */
  async forceRelease(): Promise<void> {
    await this.store.forget(this.key)
  }
}
