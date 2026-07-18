import type { Comment } from '../models/Comment'
import type { Post } from '../models/Post'

/** Dispatched after a comment is saved. Listeners: `SendCommentNotification`. */
export class CommentPosted {
  constructor(
    public readonly comment: Comment,
    public readonly post: Post,
  ) {}
}

export default CommentPosted
