import { defineQueueConfig } from '@elysia-ravel/queue'

/**
 * Queue config. `sync` runs jobs inline (great for local dev/tests); the other
 * connections enqueue for a worker started with `ravel queue:work`.
 * Dispatch via the `dispatch()` helper: `await dispatch(new SendWelcomeEmail(email))`.
 */
export default defineQueueConfig({
  default: process.env.QUEUE_CONNECTION ?? 'sync',
  connections: {
    sync: { driver: 'sync' },
    memory: { driver: 'memory' }, // per-process; lost on restart
    database: { driver: 'database' }, // uses the `jobs` table (wired in AppServiceProvider)
    redis: { driver: 'redis', url: process.env.REDIS_URL, queue: 'queues' }, // key prefix; lanes become queues:<name>
  },
})
