import type { Comment } from '../models/Comment'
import { Resource } from '@elyvel/core'

/** Shape a Comment for JSON/Inertia props. `is_mine` only appears for a signed-in viewer. */
export function commentResource(comment: Comment, viewerId?: string) {
  return {
    id: comment.id,
    author_name: comment.author_name,
    body: comment.body,
    created_at: comment.created_at.toISOString(),
    is_mine: Resource.when(viewerId !== undefined, () => viewerId === comment.user_id),
  }
}

export default commentResource
