import { createApp } from '@elysia-ravel/core'
import { failedJobs, QueueToken, Worker } from '@elysia-ravel/queue'

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
    connection: connection ?? 'default',
    failed: failedJobs(),
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

/** Boot the app and return the failed-job repository, or null if not wired. */
async function bootFailed() {
  const app = await createApp({ basePath: process.cwd(), autoloadRoutes: false })
  return { app, repo: failedJobs() }
}

function notConfigured(): number {
  console.error(
    'Failed-job storage is not configured. Wire it with configureFailedJobs(...) in a service provider\n' +
      '(the example uses the `failed_jobs` table).',
  )
  return 1
}

/** `ravel queue:failed` — list recorded failed jobs. */
export async function queueFailedCommand(): Promise<number> {
  const { repo } = await bootFailed()
  if (!repo) return notConfigured()
  const rows = await repo.all()
  if (rows.length === 0) {
    console.log('No failed jobs.')
    return 0
  }
  for (const r of rows) {
    const when = new Date(r.failedAt).toISOString()
    const first = r.exception.split('\n')[0]
    console.log(`${r.id}  [${r.connection}]  ${when}\n    ${first}`)
  }
  return 0
}

/** `ravel queue:retry <id>` or `--all` — re-queue failed jobs. */
export async function queueRetryCommand(id: string | undefined, flags: Record<string, string | boolean>): Promise<number> {
  const { app, repo } = await bootFailed()
  if (!repo) return notConfigured()
  const manager = app.make(QueueToken)

  const targets = flags.all === true ? await repo.all() : id ? [await repo.find(id)] : []
  if (targets.length === 0 || targets[0] == null) {
    console.error('Provide a failed-job id or --all.')
    return 1
  }

  let retried = 0
  for (const job of targets) {
    if (!job) continue
    const store = manager.store(job.connection)
    if (store === 'sync') {
      console.error(`✗ ${job.id}: connection "${job.connection}" is sync — nothing to re-queue.`)
      continue
    }
    await store.push(job.body)
    await repo.forget(job.id)
    console.log(`✓ re-queued ${job.id}`)
    retried++
  }
  console.log(`Re-queued ${retried} job(s).`)
  return 0
}

/** `ravel queue:forget <id>` — delete a failed job. */
export async function queueForgetCommand(id: string | undefined): Promise<number> {
  const { repo } = await bootFailed()
  if (!repo) return notConfigured()
  if (!id) {
    console.error('Provide a failed-job id.')
    return 1
  }
  const removed = await repo.forget(id)
  console.log(removed ? `Deleted ${id}.` : `No failed job with id ${id}.`)
  return removed ? 0 : 1
}

/** `ravel queue:flush` — delete all failed jobs. */
export async function queueFlushCommand(): Promise<number> {
  const { repo } = await bootFailed()
  if (!repo) return notConfigured()
  await repo.flush()
  console.log('Flushed all failed jobs.')
  return 0
}
