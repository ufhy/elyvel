import type { CacheStore } from './store'
import { createHash, randomUUID } from 'node:crypto'

/**
 * A tag-scoped view over a {@link CacheStore} — Laravel's `Cache::tags(...)`.
 *
 * Uses the "tag version" scheme (same as Laravel's default TaggedCache): each
 * tag has a random version id stored in the cache, and a tagged entry's real
 * storage key is namespaced by a hash of its tags' current versions. Flushing
 * a tag just resets its version — every entry keyed under the old version
 * becomes unreachable and expires on its own TTL. This needs no per-store
 * bookkeeping of member keys, so it works identically on memory/file/database/
 * redis. Tag order doesn't matter (names are sorted before hashing).
 */
export class TaggedCache {
  private readonly names: string[]

  constructor(private readonly store: CacheStore, names: string[]) {
    // Sort so tags(['a','b']) and tags(['b','a']) address the same entries.
    this.names = [...new Set(names)].sort()
  }

  private tagVersionKey(name: string): string {
    return `tag:${name}:version`
  }

  /** The current version id for a tag, creating (and persisting forever) one if absent. */
  private async tagVersion(name: string): Promise<string> {
    const key = this.tagVersionKey(name)
    const existing = await this.store.get<string>(key)
    if (existing !== undefined)
      return existing
    const version = randomUUID()
    await this.store.put(key, version) // forever
    return version
  }

  /** Namespace prefix derived from every tag's current version. */
  private async namespace(): Promise<string> {
    const versions = await Promise.all(this.names.map(name => this.tagVersion(name)))
    return createHash('sha1').update(versions.join('|')).digest('hex')
  }

  /** The real storage key for a user key under the current tag versions. */
  private async k(key: string): Promise<string> {
    return `${await this.namespace()}:${key}`
  }

  async get<T = unknown>(key: string, fallback?: T): Promise<T | undefined> {
    const value = await this.store.get<T>(await this.k(key))
    return value === undefined ? fallback : value
  }

  async put(key: string, value: unknown, seconds?: number): Promise<void> {
    await this.store.put(await this.k(key), value, seconds)
  }

  async forever(key: string, value: unknown): Promise<void> {
    await this.store.put(await this.k(key), value)
  }

  async add(key: string, value: unknown, seconds?: number): Promise<boolean> {
    if (await this.has(key))
      return false
    await this.put(key, value, seconds)
    return true
  }

  async has(key: string): Promise<boolean> {
    return (await this.store.get(await this.k(key))) !== undefined
  }

  async missing(key: string): Promise<boolean> {
    return !(await this.has(key))
  }

  async forget(key: string): Promise<void> {
    await this.store.forget(await this.k(key))
  }

  async increment(key: string, by = 1): Promise<number> {
    return this.store.increment(await this.k(key), by)
  }

  async decrement(key: string, by = 1): Promise<number> {
    return this.store.decrement(await this.k(key), by)
  }

  async pull<T = unknown>(key: string, fallback?: T): Promise<T | undefined> {
    const real = await this.k(key)
    const value = await this.store.get<T>(real)
    await this.store.forget(real)
    return value === undefined ? fallback : value
  }

  async remember<T>(key: string, seconds: number, factory: () => T | Promise<T>): Promise<T> {
    const existing = await this.get<T>(key)
    if (existing !== undefined)
      return existing
    const value = await factory()
    await this.put(key, value, seconds)
    return value
  }

  async rememberForever<T>(key: string, factory: () => T | Promise<T>): Promise<T> {
    const existing = await this.get<T>(key)
    if (existing !== undefined)
      return existing
    const value = await factory()
    await this.forever(key, value)
    return value
  }

  /**
   * Flush only the entries tagged with THESE tags — by resetting each tag's
   * version, which orphans every entry keyed under the old versions (they
   * become unreachable and expire naturally). Other tags' entries are
   * untouched, unlike the store's global `flush()`.
   */
  async flush(): Promise<void> {
    for (const name of this.names)
      await this.store.put(this.tagVersionKey(name), randomUUID())
  }
}
