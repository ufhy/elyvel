import { defineQueueConfig } from '@elyvel/queue'

/**
 * `database` (not `sync`/`memory`) so `elyvel queue:work` can run as its own
 * long-lived process, separate from the web server, and still see jobs
 * dispatched from an HTTP request — see AppServiceProvider's
 * configureDatabaseQueue() wiring (jobs table).
 */
export default defineQueueConfig({
  default: 'database',
  connections: {
    database: { driver: 'database' },
  },
})
