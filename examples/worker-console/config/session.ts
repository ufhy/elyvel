import { defineSessionConfig } from '@elyvel/core'

/**
 * `database` (not `cookie`) — dogfoods AppServiceProvider's
 * configureDatabaseSession() wiring (sessions table) against a real
 * connection, same as the cache/queue database drivers in this app.
 */
export default defineSessionConfig({
  driver: 'database',
  cookie: 'elyvel_session',
  lifetime: 60 * 120, // 2 hours
})
