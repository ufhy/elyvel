import type { Comment } from '../models/Comment'
import type { Post } from '../models/Post'
import { Broadcastable } from '@elyvel/broadcasting'
import { commentResource } from '../resources/CommentResource'

/**
 * Broadcast to everyone viewing a post when a new comment lands — see
 * `resources/js/pages/Blog/Show.vue`'s WebSocket subscription. The
 * `private-` prefix routes subscription attempts through the `channel()` rule
 * registered in `AppServiceProvider` (published → anyone; unpublished →
 * author only), so an unpublished post's comments can't leak to a guessed id.
 */
export class CommentBroadcast extends Broadcastable {
  constructor(private readonly comment: Comment, private readonly post: Post) {
    super()
  }

  override broadcastOn(): string[] {
    return [`private-posts.${this.post.id}`]
  }

  override broadcastWith(): Record<string, unknown> {
    return { comment: commentResource(this.comment) }
  }
}

export default CommentBroadcast
