import type { User } from '@elyvel/auth'
import type { Post } from '../models/Post'
import { Response } from '@elyvel/auth'
import { trans } from '@elyvel/support'

/**
 * PostPolicy — authorization for Post. Registered in AppServiceProvider:
 *   gate().policy(Post, new PostPolicy())
 *
 * Only `update`/`delete` are actually enforced by PostController (the blog's
 * public pages — index/show — never go through the gate: policy checks always
 * deny a `null` user, so they're not usable for guest-visible reads anyway).
 * The rest are implemented for completeness, mirroring what
 * `elyvel make:policy --model` scaffolds for full CRUD.
 */
export class PostPolicy {
  /** List posts (any signed-in user; the public index doesn't call this). */
  viewAny(_user: User | null): boolean {
    return true
  }

  /** View a single post (any signed-in user; the public show doesn't call this). */
  view(_user: User | null, _model: Post): boolean {
    return true
  }

  /** Create a post — any signed-in user. */
  create(_user: User | null): boolean {
    return true
  }

  /** Only the author may update their post. */
  update(user: User | null, model: Post): boolean | Response {
    return user?.id === model.user_id
      ? Response.allow()
      : Response.deny(trans('blog.not_author_update', {}, 'You can only edit your own posts.'))
  }

  /** Only the author may delete their post. */
  delete(user: User | null, model: Post): boolean | Response {
    return user?.id === model.user_id
      ? Response.allow()
      : Response.deny(trans('blog.not_author_delete', {}, 'You can only delete your own posts.'))
  }

  /** Only the author may restore their soft-deleted post. */
  restore(user: User | null, model: Post): boolean {
    return user?.id === model.user_id
  }

  /** Only the author may permanently delete their post. */
  forceDelete(user: User | null, model: Post): boolean {
    return user?.id === model.user_id
  }
}

export default PostPolicy
