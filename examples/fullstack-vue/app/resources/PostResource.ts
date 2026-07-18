import type { Comment } from '../models/Comment'
import type { Post } from '../models/Post'
import { Resource } from '@elyvel/core'
import { commentResource } from './CommentResource'

/**
 * Shape a Post for JSON/Inertia props. `comments` only appears when eager-
 * loaded (`Post.with('comments')`) — never a lazy N+1 query. `is_mine` only
 * appears when a viewer id is passed (omitted entirely for guests).
 */
export function postResource(post: Post, viewerId?: string) {
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    body: post.body,
    author_name: post.author_name,
    published: post.published,
    published_at: post.published_at?.toISOString() ?? null,
    created_at: post.created_at.toISOString(),
    is_mine: Resource.when(viewerId !== undefined, () => viewerId === post.user_id),
    comments: Resource.whenLoaded(post, 'comments', (comments: Comment[]) =>
      comments.map(c => commentResource(c, viewerId))),
  }
}

export function postCollection(posts: Post[], viewerId?: string): { data: unknown[] } {
  return Resource.collection(posts, p => postResource(p, viewerId))
}

export default postResource
