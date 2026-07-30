import type { CacheStore } from './store'
import { coalesce } from './coalesce'
import { Lock, supportsLocks } from './lock'
import { TaggedCache } from './tagged-cache'

/**
 * The cache repository — Laravel's `Cache` API over a {@link CacheStore}.
 * `seconds` omitted means "forever".
 */
export class Repository {
  // Coalesces concurrent `remember()`/`rememberForever()` misses for the SAME
  // key within this process — without this, N concurrent requests racing a
  // cold/expired key all see `get()` return undefined and all invoke
  // `factory()` (a thundering herd against the origin DB/API on any popular
  // key's expiry). Only the first caller actually runs `factory()`; the rest
  // await its result. This dedupes WITHIN one process; it doesn't coordinate
  // across instances sharing a `redis`/`database` store — wrap the factory in
  // `lock()` when you need that — but since
  // every instance already dedupes its own concurrent callers, an N-instance
  // fleet still goes from "however many concurrent requests landed" down to
  // "at most N" factory() calls, not eliminated but substantially reduced.

  constructor(private readonly store: CacheStore) {}

  /**
   * A tag-scoped cache view (Laravel's `Cache::tags(...)`): entries stored
   * through it can be flushed as a group with `.flush()`, without touching the
   * rest of the cache. Backed by tag versions, so it works on every store.
   */
  tags(names: string | string[]): TaggedCache {
    return new TaggedCache(this.store, Array.isArray(names) ? names : [names])
  }

  /**
   * An owner-checked mutex on top of this store — Laravel's `Cache::lock()`.
   *
   * ```ts
   * await cache().lock('rebuild-sitemap', 300).acquire(() => rebuildSitemap())
   * ```
   *
   * See {@link Lock} for the ownership and TTL semantics. Only a store with
   * atomic `add` + `forgetIf` can back one; anything else throws here rather than
   * handing back a lock that two callers could hold at once.
   */
  lock(name: string, seconds = 60, owner?: string): Lock {
    if (!supportsLocks(this.store)) {
      throw new Error(
        `[elyvel] The configured cache store cannot provide locks: it needs atomic `
        + '`add` and `forgetIf`. Use the memory, file, redis or database store, or '
        + 'implement both on your custom store.',
      )
    }
    return new Lock(this.store, name, seconds, owner)
  }

  /**
   * Rebuild a lock held elsewhere from its owner token, so the process that
   * releases it needn't be the one that took it — the queued-job case: acquire in
   * the request, pass `lock.owner()` in the payload, release from the worker.
   */
  restoreLock(name: string, owner: string, seconds = 60): Lock {
    return this.lock(name, seconds, owner)
  }

  async get(key: string): Promise<unknown>
  async get<T>(key: string, fallback: T): Promise<T>
  async get(key: string, fallback?: unknown): Promise<unknown> {
    const value = await this.store.get(key)
    return value === undefined ? fallback : value
  }

  put(key: string, value: unknown, seconds?: number): Promise<void> {
    return this.store.put(key, value, seconds)
  }

  /** Alias of {@link put}. */
  set(key: string, value: unknown, seconds?: number): Promise<void> {
    return this.put(key, value, seconds)
  }

  forever(key: string, value: unknown): Promise<void> {
    return this.store.put(key, value)
  }

  /**
   * Store only if the key is absent. Returns whether it was stored.
   *
   * Uses the store's atomic `add` when it has one (memory, file, redis, and
   * database with an adapter that supports it), so two concurrent callers
   * can't both be told they won — which matters because this is the
   * once-only guard people build on. Falls back to a racy read-then-write
   * only on a store that can't do better.
   */
  async add(key: string, value: unknown, seconds?: number): Promise<boolean> {
    if (this.store.add)
      return this.store.add(key, value, seconds)
    if (await this.has(key))
      return false
    await this.put(key, value, seconds)
    return true
  }

  async has(key: string): Promise<boolean> {
    return (await this.store.get(key)) !== undefined
  }

  async missing(key: string): Promise<boolean> {
    return !(await this.has(key))
  }

  forget(key: string): Promise<void> {
    return this.store.forget(key)
  }

  flush(): Promise<void> {
    return this.store.flush()
  }

  increment(key: string, by = 1): Promise<number> {
    return this.store.increment(key, by)
  }

  decrement(key: string, by = 1): Promise<number> {
    return this.store.decrement(key, by)
  }

  /** Retrieve and delete in one step. */
  async pull(key: string): Promise<unknown>
  async pull<T>(key: string, fallback: T): Promise<T>
  async pull(key: string, fallback?: unknown): Promise<unknown> {
    // The store's atomic read-and-delete where available, so a single-use
    // value can't be handed to two concurrent callers.
    const value = this.store.pull
      ? await this.store.pull(key)
      : await (async () => {
          const v = await this.store.get(key)
          await this.forget(key)
          return v
        })()
    return value === undefined ? fallback : value
  }

  /** Get the value, or compute+store it (for `seconds`) and return it. */
  async remember<T>(key: string, seconds: number, factory: () => T | Promise<T>): Promise<T> {
    const existing = await this.store.get<T>(key)
    if (existing !== undefined)
      return existing
    return this.coalesce(key, async () => {
      const value = await factory()
      await this.put(key, value, seconds)
      return value
    })
  }

  /** Like {@link remember} but stored forever. */
  async rememberForever<T>(key: string, factory: () => T | Promise<T>): Promise<T> {
    const existing = await this.store.get<T>(key)
    if (existing !== undefined)
      return existing
    return this.coalesce(key, async () => {
      const value = await factory()
      await this.forever(key, value)
      return value
    })
  }

  /**
   * Run `compute` once per key, sharing the result with any concurrent caller.
   * Keyed on the STORE (see `coalesce.ts`) so a tagged view of the same cache
   * shares the same in-flight work instead of stampeding alongside it.
   */
  private coalesce<T>(key: string, compute: () => Promise<T>): Promise<T> {
    return coalesce(this.store, key, compute)
  }
}
