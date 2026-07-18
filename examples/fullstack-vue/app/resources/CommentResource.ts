import type { Comment } from '../models/Comment'

/** Shape a Comment for JSON/Inertia props. */
export function commentResource(comment: Comment) {
  return {
    id: comment.id,
    author_name: comment.author_name,
    body: comment.body,
    created_at: comment.created_at.toISOString(),
  }
}

export default commentResource
