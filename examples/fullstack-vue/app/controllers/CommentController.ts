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

/**
 * Comments on a post — JSON-only (`apiResource`, no `create`/`edit` form),
 * nested under `/blog/:post/comments`. Requires auth (see routes/blog.ts).
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

  /** DELETE /blog/:post/comments/:id — only the comment's own author. */
  async destroy(ctx: MiddlewareContext) {
    const comment = await Comment.find(ctx.params.id)
    if (!comment) {
      return ctx.status(404, { message: trans('errors.not_found', { resource: 'comment' }, 'Comment not found') })
    }
    const user = ctx.user as User
    if (comment.user_id !== user.id) {
      return ctx.status(403, { message: trans('errors.unauthorized', {}, 'This action is unauthorized.') })
    }
    await comment.delete()
    return ctx.status(204)
  }
}

export default CommentController
