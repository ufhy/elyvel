import type { CacheStore } from './store'

/**
 * The cache repository — Laravel's `Cache` API over a {@link CacheStore}.
 * `seconds` omitted means "forever".
 */
export class Repository {
  constructor(private readonly store: CacheStore) {}

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
  /** Store only if the key is absent. Returns whether it was stored. */
  async add(key: string, value: unknown, seconds?: number): Promise<boolean> {
    if (await this.has(key)) return false
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
    const value = await this.store.get(key)
    await this.forget(key)
    return value === undefined ? fallback : value
  }
  /** Get the value, or compute+store it (for `seconds`) and return it. */
  async remember<T>(key: string, seconds: number, factory: () => T | Promise<T>): Promise<T> {
    const existing = await this.store.get<T>(key)
    if (existing !== undefined) return existing
    const value = await factory()
    await this.put(key, value, seconds)
    return value
  }
  /** Like {@link remember} but stored forever. */
  async rememberForever<T>(key: string, factory: () => T | Promise<T>): Promise<T> {
    const existing = await this.store.get<T>(key)
    if (existing !== undefined) return existing
    const value = await factory()
    await this.forever(key, value)
    return value
  }
}
