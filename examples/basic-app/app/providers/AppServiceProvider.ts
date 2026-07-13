import { configureDatabaseCache } from '@elysia-ravel/cache'
import { configureDatabaseSession, ServiceProvider } from '@elysia-ravel/core'
import { table } from '@elysia-ravel/database'
import { configureDatabaseQueue, registerJob } from '@elysia-ravel/queue'
import { configureDbRules } from '@elysia-ravel/validation'
import { SendWelcomeEmail } from '../jobs/SendWelcomeEmail'

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

    // Wire the `database` queue driver (config/queue.ts) to the `jobs` table.
    configureDatabaseQueue({
      insert: async (id, body, attempts, availableAt) => {
        await table('jobs').insert({ id, body, attempts, available_at: availableAt })
      },
      takeReady: async (now) => {
        const row = await table('jobs').where('available_at', '<=', now).orderBy('available_at').first()
        if (!row) return null
        await table('jobs').where('id', row.id).delete()
        return { id: String(row.id), body: String(row.body), attempts: Number(row.attempts) }
      },
      count: async () => table('jobs').count(),
    })
  }
}
