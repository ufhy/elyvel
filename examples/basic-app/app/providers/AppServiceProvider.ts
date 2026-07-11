import { ServiceProvider } from '@elysia-ravel/core'

/**
 * The application's own service provider — the place to bind app-wide services
 * into the container and run startup logic.
 */
export class AppServiceProvider extends ServiceProvider {
  override boot(): void {
    const appName = this.app.config.get<string>('app.name')
    this.app.logger.child('app').info('application booted', { appName })
  }
}
