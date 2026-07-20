import type { User } from '@elyvel/auth'
import type { Comment } from '../models/Comment'
import { Response } from '@elyvel/auth'
import { trans } from '@elyvel/support'

/**
 * CommentPolicy — authorization for Comment. Registered in AppServiceProvider:
 *   gate().policy(Comment, new CommentPolicy())
 *
 * Mirrors PostPolicy's shape/consistency (route-model-binding + gate, instead
 * of an inline `if (comment.user_id !== user.id)` check in the controller).
 */
export class CommentPolicy {
  /** Only the author may delete their own comment. */
  delete(user: User | null, model: Comment): boolean | Response {
    return user?.id === model.user_id
      ? Response.allow()
      : Response.deny(trans('blog.not_author_delete_comment', {}, 'You can only delete your own comments.'))
  }
}

export default CommentPolicy
