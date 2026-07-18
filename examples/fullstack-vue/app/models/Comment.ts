import type { Dayjs } from '@elyvel/database'
import { Model } from '@elyvel/database'
import { Post } from './Post'

/** A comment on a {@link Post}. Author is a plain `user_id`/`author_name` pair (see Post). */
export class Comment extends Model {
  static override table = 'comments'
  // post_id/user_id/author_name are trusted server fields merged in by the
  // controller — a FormRequest's validated() data never contains them, so
  // listing them here doesn't reopen mass-assignment to user input.
  static override fillable = ['post_id', 'user_id', 'author_name', 'body']

  declare id: number
  declare post_id: number
  declare user_id: string
  declare author_name: string
  declare body: string
  declare created_at: Dayjs
  declare updated_at: Dayjs

  post() {
    return this.belongsTo(Post)
  }
}

export default Comment
