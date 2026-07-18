import { gate } from '@elyvel/auth'
import { ServiceProvider } from '@elyvel/core'
import { Post } from '../models/Post'
import { PostPolicy } from '../policies/PostPolicy'

/**
 * The application's own service provider — bind app-wide services into the
 * container (in `register`) and run startup logic (in `boot`).
 */
export class AppServiceProvider extends ServiceProvider {
  override boot(): void {
    const appName = this.app.config.get<string>('app.name')
    this.app.logger.child('app').info('application booted', { appName })

    gate().policy(Post, new PostPolicy())
  }
}
