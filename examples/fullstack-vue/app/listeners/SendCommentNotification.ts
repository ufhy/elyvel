import type { CommentPosted } from '../events/CommentPosted'
import { QueuedListener } from '@elyvel/events'
import { notify } from '@elyvel/notifications'
import { NewCommentNotification } from '../notifications/NewCommentNotification'

/**
 * Listens for `CommentPosted` and mails the post's author. Extends
 * `QueuedListener` so it's pushed onto the queue (`config/queue.ts`) instead
 * of blocking the comment's own request on an outbound mail send.
 */
export class SendCommentNotification extends QueuedListener<CommentPosted> {
  async handle(event: CommentPosted): Promise<void> {
    const { comment, post } = event
    // Don't notify authors about their own comments.
    if (comment.user_id === post.user_id)
      return
    await notify({ id: post.user_id }, new NewCommentNotification(comment, post))
  }
}

export default SendCommentNotification
