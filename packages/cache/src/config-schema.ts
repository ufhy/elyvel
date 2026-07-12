export interface CacheStoreConfig {
  driver: 'memory' | 'file'
  /** Directory for the `file` driver (relative to app root; default `storage/cache`). */
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
