import { defineCacheConfig } from '@elysia-ravel/cache'

/**
 * Cache config. `memory` is per-process; `file` persists under storage/.
 * Use via the `cache()` helper: `await cache().remember('key', 60, fn)`.
 */
export default defineCacheConfig({
  default: process.env.CACHE_STORE ?? 'memory',
  stores: {
    memory: { driver: 'memory' },
    file: { driver: 'file', path: 'storage/framework/cache' },
    database: { driver: 'database' }, // uses the `cache` table (wired in AppServiceProvider)
    redis: { driver: 'redis', url: process.env.REDIS_URL }, // Bun's built-in Redis client
  },
})
