import { defineQueueConfig } from '@elyvel/queue'

/**
 * Queue config. `sync` runs jobs inline — no worker needed, good for dev/tests.
 * Switch to `database`/`redis` and run `elyvel queue:work` to process jobs in
 * the background.
 */
export default defineQueueConfig({
  default: process.env.QUEUE_CONNECTION ?? 'sync',
  connections: {
    sync: { driver: 'sync' },
    database: { driver: 'database' },
    redis: { driver: 'redis', url: process.env.REDIS_URL },
  },
})
