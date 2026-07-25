import type { User } from '@elyvel/auth'
import { AuthActions, gate } from '@elyvel/auth'
import { channel } from '@elyvel/broadcasting'
import { ServiceProvider } from '@elyvel/core'
import { configureLogViewer } from '@elyvel/log-viewer'
import { configureFailedJobs } from '@elyvel/queue'
import { Password } from '@elyvel/validation'
import { Comment } from '../models/Comment'
import { Post } from '../models/Post'
import { CommentPolicy } from '../policies/CommentPolicy'
import { PostPolicy } from '../policies/PostPolicy'
import { RegisterRequest } from '../requests/RegisterRequest'
import { DatabaseFailedJobStore } from '../support/DatabaseFailedJobStore'

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
    gate().policy(Comment, new CommentPolicy())

    // App-wide password policy (Laravel's `Password::defaults()`). One place —
    // it governs registration, password reset, and change-password alike, and
    // Better Auth's own `minPasswordLength` is synced from it. Lenient locally,
    // stricter in production.
    const isProduction = this.app.config.get<string>('app.env') === 'production'
    Password.defaults(() =>
      isProduction
        ? Password.min(10).mixedCase().numbers()
        : Password.min(8),
    )

    // Swap the default registration validation for one that also requires
    // `password_confirmation` (Fortify's `createUsersUsing` analog).
    AuthActions.registerUsing(RegisterRequest)

    // A published post's comment stream is public (guests watch too); an
    // unpublished one is author-only — same rule PostController.show()
    // already enforces over HTTP, now applied to the WebSocket channel too so
    // a guessed post id can't leak an unpublished post's live comments.
    channel('private-posts.{postId}', async (identity, { postId }) => {
      const post = await Post.find(postId)
      if (!post)
        return false
      return post.published || (identity as User | null)?.id === post.user_id
    })

    configureLogViewer({
      authorize: ctx => LOG_VIEWER_ADMINS.includes((ctx.user as User | null)?.email ?? ''),
    })

    // Persists failed jobs to the `failed_jobs` table instead of the
    // in-memory default, so `elyvel queue:failed`/`queue:retry` see them
    // across restarts and across worker processes.
    configureFailedJobs(new DatabaseFailedJobStore())
  }
}
