import { defineCacheConfig } from '@elyvel/cache'

/**
 * `database` (not `memory`) so a cached value written by one process (the web
 * server) is visible to another (e.g. `queue:work`) — see
 * AppServiceProvider's configureDatabaseCache() wiring (cache table).
 */
export default defineCacheConfig({
  default: 'database',
  stores: {
    database: { driver: 'database' },
  },
})
