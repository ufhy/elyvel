import type { User } from '@elyvel/auth'
import type { MiddlewareContext } from '@elyvel/core'
import { broadcast } from '@elyvel/broadcasting'
import { Controller } from '@elyvel/core'
import { event } from '@elyvel/events'
import { trans } from '@elyvel/support'
import { CommentBroadcast } from '../broadcasts/CommentBroadcast'
import { CommentPosted } from '../events/CommentPosted'
import { Comment } from '../models/Comment'
import { Post } from '../models/Post'
import { StoreCommentRequest } from '../requests/StoreCommentRequest'
import { commentResource } from '../resources/CommentResource'

/** `ctx.authorize` is derived at runtime (typed `unknown` on MiddlewareContext) — cast once here, matching PostController. */
function authorize(ctx: MiddlewareContext, ability: string, ...args: unknown[]): void {
  (ctx.authorize as (a: string, ...x: unknown[]) => void)(ability, ...args)
}

/**
 * Comments on a post — JSON-only (`apiResource`, no `create`/`edit` form),
 * nested under `/blog/:post/comments`. Requires auth (see routes/blog.ts).
 * `destroy` is route-model-bound (`bind: Comment`), so `ctx.model` is always a
 * loaded Comment there — same pattern PostController uses for its own binding.
 */
export class CommentController extends Controller {
  /** POST /blog/:post/comments */
  async store(ctx: MiddlewareContext) {
    const post = await Post.find(ctx.params.post)
    if (!post) {
      return ctx.status(404, { message: trans('errors.not_found', { resource: 'post' }, 'Post not found') })
    }

    const validated = await StoreCommentRequest.validate(ctx)
    const user = ctx.user as User
    const comment = await Comment.create({
      ...validated,
      post_id: post.id,
      user_id: user.id,
      author_name: user.name,
    })

    await event(new CommentPosted(comment, post))
    await broadcast(new CommentBroadcast(comment, post))
    return ctx.status(201, { data: commentResource(comment) })
  }

  /** DELETE /blog/:post/comments/:id — only the comment's own author (CommentPolicy). */
  async destroy(ctx: MiddlewareContext) {
    const comment = ctx.model as Comment
    authorize(ctx, 'delete', comment)
    await comment.delete()
    return ctx.status(204)
  }
}

export default CommentController
