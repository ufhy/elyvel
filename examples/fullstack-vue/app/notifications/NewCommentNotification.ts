import type { Notifiable } from '@elyvel/notifications'
import type { Comment } from '../models/Comment'
import type { Post } from '../models/Post'
import { Message } from '@elyvel/mail'
import { Notification } from '@elyvel/notifications'

/** Notifies a post's author that someone commented on it (mail channel — see config/mail.ts). */
export class NewCommentNotification extends Notification {
  constructor(
    private readonly comment: Comment,
    private readonly post: Post,
  ) {
    super()
  }

  override via(): string[] {
    return ['mail']
  }

  override toMail(_notifiable: Notifiable): Message {
    return new Message()
      .to(this.post.author_email)
      .subject(`New comment on "${this.post.title}"`)
      .html(
        `<p><strong>${this.comment.author_name}</strong> commented on your post `
        + `<strong>${this.post.title}</strong>:</p><blockquote>${this.comment.body}</blockquote>`,
      )
  }
}

export default NewCommentNotification
