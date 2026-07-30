import { CacheServiceProvider } from './provider'

export { type CacheConfig, type CacheStoreConfig, defineCacheConfig } from './config-schema'
export { Lock, LockTimeoutError, supportsLocks } from './lock'
export { cache, CacheManager, setDefaultCache } from './manager'
export { CacheServiceProvider, CacheToken } from './provider'
export { Repository } from './repository'
export {
  type CacheDbAdapter,
  type CacheStore,
  configureDatabaseCache,
  DatabaseStore,
  FileStore,
  MemoryStore,
  type RedisLike,
  RedisStore,
} from './store'
export { TaggedCache } from './tagged-cache'

/** Read by `elyvel package:discover` — see packages/core's discovery loader. */
export const elyvelProviders = [CacheServiceProvider]
