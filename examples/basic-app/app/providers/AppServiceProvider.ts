import { configureDatabaseCache } from '@elysia-ravel/cache'
import { configureDatabaseSession, ServiceProvider } from '@elysia-ravel/core'
import { table } from '@elysia-ravel/database'
import { configureDbRules } from '@elysia-ravel/validation'

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
  }
}
