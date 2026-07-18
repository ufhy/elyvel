import type { CommentPosted } from '../events/CommentPosted'
import { notify } from '@elyvel/notifications'
import { NewCommentNotification } from '../notifications/NewCommentNotification'

/** Listens for `CommentPosted` and mails the post's author. */
export class SendCommentNotification {
  async handle(event: CommentPosted): Promise<void> {
    const { comment, post } = event
    // Don't notify authors about their own comments.
    if (comment.user_id === post.user_id)
      return
    await notify({ id: post.user_id }, new NewCommentNotification(comment, post))
  }
}

export default SendCommentNotification
