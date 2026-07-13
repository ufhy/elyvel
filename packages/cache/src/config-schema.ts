export interface CacheStoreConfig {
  driver: 'memory' | 'file' | 'database' | 'redis'
  /** Directory for the `file` driver (relative to app root; default `storage/framework/cache`). */
  path?: string
  /** Connection URL for the `redis` driver (default: Bun's `REDIS_URL` / localhost). */
  url?: string
  /** Key prefix for the `redis` driver (default `cache:`). */
  prefix?: string
}

/** Shape of `config/cache.ts`. Author it with {@link defineCacheConfig}. */
export interface CacheConfig {
  /** Default store name. Default `memory`. */
  default?: string
  /** Named stores. `memory` is always available even without config. */
  stores?: Record<string, CacheStoreConfig>
}

export function defineCacheConfig(config: CacheConfig): CacheConfig {
  return config
}
