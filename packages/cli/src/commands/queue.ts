import { createApp } from '@elysia-ravel/core'
import { QueueToken, Worker } from '@elysia-ravel/queue'

/**
 * `ravel queue:work` — process jobs off a queue connection.
 *
 * Flags:
 *   --connection=<name>   Connection from config/queue.ts (default: configured default)
 *   --sleep=<seconds>     Poll interval when the queue is empty (default 1)
 *   --tries / --retry-after=<seconds>  Delay before retrying a failed job (default 0)
 *   --once                Process a single job then exit
 *   --stop-when-empty     Drain the queue then exit (useful for CI / one-shot runs)
 *   --max=<n>             Stop after processing N jobs
 */
export async function queueWorkCommand(flags: Record<string, string | boolean>): Promise<number> {
  const app = await createApp({ basePath: process.cwd(), autoloadRoutes: false })
  const manager = app.make(QueueToken)

  const connection = typeof flags.connection === 'string' ? flags.connection : undefined
  const store = manager.store(connection)
  if (store === 'sync') {
    console.error(
      'The "sync" connection runs jobs inline and has no queue to work.\n' +
        'Set a queued connection (memory/database/redis) as default, or pass --connection=<name>.',
    )
    return 1
  }

  const worker = new Worker(store, {
    retryAfter: flags['retry-after'] ? Number(flags['retry-after']) : 0,
    onError: (name, error, willRetry) => {
      const detail = error instanceof Error ? error.message : String(error)
      console.error(`✗ ${name} failed: ${detail}${willRetry ? ' (will retry)' : ' (giving up)'}`)
    },
  })

  const once = flags.once === true
  const stopWhenEmpty = flags['stop-when-empty'] === true
  const max = flags.max ? Number(flags.max) : undefined
  const sleepMs = flags.sleep ? Number(flags.sleep) * 1000 : 1000

  console.log(`Processing jobs on "${connection ?? 'default'}"${once ? ' (once)' : stopWhenEmpty ? ' until empty' : '...'}`)
  const processed = await worker.work({ once, stopWhenEmpty, max, sleepMs })
  if (once || stopWhenEmpty || max) console.log(`Done. Processed ${processed} job(s).`)
  return 0
}
