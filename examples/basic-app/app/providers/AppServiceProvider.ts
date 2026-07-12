import { ServiceProvider } from '@elysia-ravel/core'
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
  }
}
