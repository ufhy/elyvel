import { ServiceProvider } from '@elyvel/core'

/**
 * The application's own service provider — bind app-wide services into the
 * container (in `register`) and run startup logic (in `boot`).
 */
export class AppServiceProvider extends ServiceProvider {
  override boot(): void {
    const appName = this.app.config.get<string>('app.name')
    this.app.logger.child('app').info('application booted', { appName })
  }
}
