import type { Dayjs } from '@elyvel/database'
import { Model, ObservedBy } from '@elyvel/database'
import { PostObserver } from '../observers/PostObserver'
import { Comment } from './Comment'

/**
 * A blog post. Authorship is a plain `user_id`/`author_name` pair, not an
 * Eloquent relation — Better Auth manages its own `users` table outside
 * Eloquent, so there's no `User` model to `belongsTo`.
 *
 * `published_at` is when a post is *scheduled* to go live (settable by the
 * author); `published` is flipped by the scheduler once that time arrives
 * (see `ScheduleServiceProvider`). Only `published` posts are publicly visible.
 */
@ObservedBy(PostObserver)
export class Post extends Model {
  static override table = 'posts'
  // user_id/author_name are trusted server fields merged in by the controller
  // (see the Comment model note). `published` is deliberately left out — only
  // the scheduler flips it, via direct attribute assignment (bypasses fillable
  // the same way Laravel's `$model->published = true` does).
  static override fillable = [
    'title',
    'slug',
    'body',
    'cover_image',
    'published_at',
    'user_id',
    'author_name',
    'author_email',
  ]

  static override casts = { published: 'boolean' as const, published_at: 'datetime' as const }
  static override softDeletes = true

  declare id: number
  declare title: string
  declare slug: string
  declare body: string
  declare cover_image: string | null
  declare user_id: string
  declare author_name: string
  declare author_email: string
  declare published: boolean
  declare published_at: Dayjs | null
  declare created_at: Dayjs
  declare updated_at: Dayjs

  comments() {
    return this.hasMany(Comment)
  }
}

export default Post
