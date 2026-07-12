export interface CacheStoreConfig {
  driver: 'memory' | 'file' | 'database'
  /** Directory for the `file` driver (relative to app root; default `storage/framework/cache`). */
  path?: string
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
