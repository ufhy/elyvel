import { configureDatabaseCache } from '@elysia-ravel/cache'
import { configureDatabaseSession, ServiceProvider } from '@elysia-ravel/core'
import { afterCommit, configureModelEventDispatcher, Model, table } from '@elysia-ravel/database'
import { event } from '@elysia-ravel/events'
import {
  type BatchRecord,
  configureAfterCommit,
  configureBatches,
  configureDatabaseQueue,
  configureFailedJobs,
  configureJobEncryption,
  configureModelSerializer,
  configureQueueEventDispatcher,
  configureRestartSignal,
  configureUniqueJobs,
  MemoryUniqueLock,
  Queue,
  registerJob,
} from '@elysia-ravel/queue'
import { BroadcastChannel } from '@elysia-ravel/broadcasting'
import { Mail } from '@elysia-ravel/mail'
import { configureDatabaseNotifications, notifications } from '@elysia-ravel/notifications'
import { configureScheduleMailer } from '@elysia-ravel/scheduler'
import { configureDbRules } from '@elysia-ravel/validation'
import { SendWelcomeEmail } from '../jobs/SendWelcomeEmail'
import { User } from '../models/User'

/**
 * The application's own service provider — the place to bind app-wide services
 * into the container and run startup logic.
 */
export class AppServiceProvider extends ServiceProvider {
  override boot(): void {
    const appName = this.app.config.get<string>('app.name')
    this.app.logger.child('app').info('application booted', { appName })

    // Wire the `unique`/`exists` validation rules to the database.
    configureDbRules({
      count: async (t, column, value, ignoreId) => {
        let query = table(t).where(column, value)
        if (ignoreId !== undefined) query = query.where('id', '!=', ignoreId)
        return query.count()
      },
    })

    // Wire the `database` cache store (config/cache.ts) to the `cache` table.
    configureDatabaseCache({
      read: async (key) => {
        const row = await table('cache').where('key', key).first()
        if (!row) return undefined
        return { value: String(row.value), expiresAt: row.expiration == null ? null : Number(row.expiration) }
      },
      write: async (key, value, expiresAt) => {
        await table('cache').updateOrInsert({ key }, { value, expiration: expiresAt })
      },
      forget: async (key) => {
        await table('cache').where('key', key).delete()
      },
      flush: async () => {
        await table('cache').truncate()
      },
    })

    // Wire the `database` session driver (config/session.ts) to the `sessions` table.
    configureDatabaseSession({
      read: async (id) => {
        const row = await table('sessions').where('id', id).first()
        return row ? String(row.payload) : undefined
      },
      write: async (id, payload, lastActivity) => {
        await table('sessions').updateOrInsert({ id }, { payload, last_activity: lastActivity })
      },
    })

    // Register job classes so the worker can reconstruct them from the queue.
    registerJob(SendWelcomeEmail)

    // Dispatch-after-commit support + unique-job locking (in-memory here; back
    // it with Redis for cross-process uniqueness in production).
    configureAfterCommit((cb) => afterCommit(cb))
    configureUniqueJobs(new MemoryUniqueLock())

    // Encrypt jobs flagged `encrypt = true` with the app key (if set).
    const appKey = this.app.config.get<string | undefined>('app.key')
    if (appKey) configureJobEncryption(appKey)

    // Log every job failure globally (bridge the queue's failing event).
    const queueLog = this.app.logger.child('queue')
    Queue.failing((name, error) => queueLog.error('job failed', { job: name, error: String(error) }))

    // Bridge queue lifecycle events to the app dispatcher (queue.processing /
    // .processed / .failed) — one event bus for the whole app.
    configureQueueEventDispatcher(async (name, payload) => {
      await event(name, payload)
    })

    // Let scheduled tasks email their captured output (Scheduler's emailOutputTo).
    configureScheduleMailer((to, subject, body) => Mail.to(to).subject(subject).html(body).send())

    // Bridge Eloquent model events to the app dispatcher, so you can
    // `listen('eloquent.created: User', ...)` (see EventServiceProvider).
    configureModelEventDispatcher(async (name, model) => {
      await event(name, model)
    })

    // Register the broadcast notification channel (Bun WebSocket pub/sub).
    notifications().channel('broadcast', new BroadcastChannel())

    // Persist database-channel notifications to the `notifications` table.
    configureDatabaseNotifications({
      insert: async (r) => {
        await table('notifications').insert({
          id: r.id,
          type: r.type,
          notifiable_id: String(r.notifiableId),
          data: JSON.stringify(r.data),
          read_at: r.readAt,
          created_at: r.createdAt,
        })
      },
    })

    // Serialize models as references and re-fetch them fresh on the worker.
    const models: Record<string, typeof Model & { find(id: unknown): Promise<Model | undefined> }> = { User }
    configureModelSerializer({
      dehydrate: (value) =>
        value instanceof Model ? { model: value.constructor.name, id: value.getKey() } : undefined,
      hydrate: async (ref) => (await models[ref.model]?.find(ref.id)) ?? null,
    })

    // Graceful worker restart (ravel queue:restart) via the cache table (cross-process).
    configureRestartSignal({
      requestedAt: async () => {
        const row = await table('cache').where('key', 'queue:restart').first()
        return row ? Number(row.value) : null
      },
      request: async () => {
        await table('cache').updateOrInsert({ key: 'queue:restart' }, { value: String(Date.now()), expiration: null })
      },
    })

    // Job batching (Bus.batch) backed by the `job_batches` table.
    const toBatch = (row: Record<string, unknown>): BatchRecord => ({
      id: String(row.id),
      name: row.name == null ? undefined : String(row.name),
      total: Number(row.total),
      pending: Number(row.pending),
      failed: Number(row.failed),
      allowFailures: Boolean(Number(row.allow_failures)),
      cancelledAt: row.cancelled_at == null ? null : Number(row.cancelled_at),
      finishedAt: row.finished_at == null ? null : Number(row.finished_at),
      createdAt: Number(row.created_at),
      onThen: row.on_then == null ? undefined : String(row.on_then),
      onCatch: row.on_catch == null ? undefined : String(row.on_catch),
      onFinally: row.on_finally == null ? undefined : String(row.on_finally),
    })
    configureBatches({
      create: async (r) => {
        await table('job_batches').insert({
          id: r.id,
          name: r.name ?? null,
          total: r.total,
          pending: r.pending,
          failed: r.failed,
          allow_failures: r.allowFailures,
          cancelled_at: r.cancelledAt,
          finished_at: r.finishedAt,
          created_at: r.createdAt,
          on_then: r.onThen ?? null,
          on_catch: r.onCatch ?? null,
          on_finally: r.onFinally ?? null,
        })
      },
      find: async (id) => {
        const row = await table('job_batches').where('id', id).first()
        return row ? toBatch(row) : null
      },
      recordJobResult: async (id, success) => {
        await table('job_batches').where('id', id).decrement('pending', 1)
        if (!success) await table('job_batches').where('id', id).increment('failed', 1)
        const row = await table('job_batches').where('id', id).first()
        return row ? toBatch(row) : null
      },
      cancel: async (id) => {
        await table('job_batches').where('id', id).update({ cancelled_at: Date.now() })
      },
      markFinished: async (id) => {
        await table('job_batches').where('id', id).update({ finished_at: Date.now() })
      },
    })

    // Wire the `database` queue driver (config/queue.ts) to the `jobs` table.
    configureDatabaseQueue({
      insert: async (id, body, attempts, availableAt, queue) => {
        await table('jobs').insert({ id, queue, body, attempts, available_at: availableAt })
      },
      takeReady: async (now, queues) => {
        // Honor queue priority: first queue with a ready job wins.
        for (const queue of queues) {
          const row = await table('jobs')
            .where('queue', queue)
            .where('available_at', '<=', now)
            .orderBy('available_at')
            .first()
          if (!row) continue
          await table('jobs').where('id', row.id).delete()
          return {
            id: String(row.id),
            body: String(row.body),
            attempts: Number(row.attempts),
            queue: String(row.queue),
          }
        }
        return null
      },
      count: async (queue) => (queue ? table('jobs').where('queue', queue).count() : table('jobs').count()),
    })

    // Persist exhausted jobs to the `failed_jobs` table (ravel queue:failed/retry/…).
    configureFailedJobs({
      log: async (r) => {
        await table('failed_jobs').insert({
          id: r.id,
          connection: r.connection,
          queue: r.queue,
          body: r.body,
          exception: r.exception,
          failed_at: r.failedAt,
        })
      },
      all: async () => {
        const rows = await table('failed_jobs').orderBy('failed_at', 'desc').get()
        return rows.map((row) => ({
          id: String(row.id),
          connection: String(row.connection),
          queue: String(row.queue),
          body: String(row.body),
          exception: String(row.exception),
          failedAt: Number(row.failed_at),
        }))
      },
      find: async (id) => {
        const row = await table('failed_jobs').where('id', id).first()
        if (!row) return null
        return {
          id: String(row.id),
          connection: String(row.connection),
          queue: String(row.queue),
          body: String(row.body),
          exception: String(row.exception),
          failedAt: Number(row.failed_at),
        }
      },
      forget: async (id) => {
        const existed = await table('failed_jobs').where('id', id).first()
        if (!existed) return false
        await table('failed_jobs').where('id', id).delete()
        return true
      },
      flush: async () => {
        await table('failed_jobs').truncate()
      },
      prune: async (beforeEpochMs) => {
        const stale = await table('failed_jobs').where('failed_at', '<', beforeEpochMs).count()
        await table('failed_jobs').where('failed_at', '<', beforeEpochMs).delete()
        return Number(stale)
      },
    })
  }
}
