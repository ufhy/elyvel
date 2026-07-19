import type { Comment } from '../models/Comment'
import type { Post } from '../models/Post'
import { Broadcastable } from '@elyvel/broadcasting'
import { commentResource } from '../resources/CommentResource'

/**
 * Broadcast to everyone viewing a post when a new comment lands — see
 * `resources/js/pages/Blog/Show.vue`'s WebSocket subscription. Channel is a
 * plain naming convention (`posts.{id}`); the framework has no private-channel
 * authorization yet, so don't put anything here a non-author shouldn't see.
 */
export class CommentBroadcast extends Broadcastable {
  constructor(private readonly comment: Comment, private readonly post: Post) {
    super()
  }

  override broadcastOn(): string[] {
    return [`posts.${this.post.id}`]
  }

  override broadcastWith(): Record<string, unknown> {
    return { comment: commentResource(this.comment) }
  }
}

export default CommentBroadcast
