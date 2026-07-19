import type { User } from '@elyvel/auth'
import { gate } from '@elyvel/auth'
import { ServiceProvider } from '@elyvel/core'
import { configureLogViewer } from '@elyvel/log-viewer'
import { Post } from '../models/Post'
import { PostPolicy } from '../policies/PostPolicy'

// Demo-only allowlist — swap for a real role/permission check (e.g. a `users.is_admin`
// column, or a Gate ability) before this app goes anywhere near production.
const LOG_VIEWER_ADMINS = ['ada@example.com']

/**
 * The application's own service provider — bind app-wide services into the
 * container (in `register`) and run startup logic (in `boot`).
 */
export class AppServiceProvider extends ServiceProvider {
  override boot(): void {
    const appName = this.app.config.get<string>('app.name')
    this.app.logger.child('app').info('application booted', { appName })

    gate().policy(Post, new PostPolicy())

    configureLogViewer({
      authorize: ctx => LOG_VIEWER_ADMINS.includes((ctx.user as User | null)?.email ?? ''),
    })
  }
}
