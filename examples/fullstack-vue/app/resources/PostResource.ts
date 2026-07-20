import type { Comment } from '../models/Comment'
import type { Post } from '../models/Post'
import { Resource } from '@elyvel/core'
import { storage } from '@elyvel/storage'
import { Str } from '@elyvel/support'
import { commentResource } from './CommentResource'

/**
 * Shape a Post for JSON/Inertia props. `comments` only appears when eager-
 * loaded (`Post.with('comments')`) — never a lazy N+1 query. `is_mine` only
 * appears when a viewer id is passed (omitted entirely for guests). `excerpt`
 * is a plain-text preview (HTML/markdown, if the body ever grows one, would
 * need stripping first) for the index card — Blog/Show renders the full `body`.
 */
export function postResource(post: Post, viewerId?: string) {
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    body: post.body,
    excerpt: Str.limit(post.body.replace(/\s+/g, ' ').trim(), 150),
    cover_image_url: post.cover_image ? storage().url(post.cover_image) : null,
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
