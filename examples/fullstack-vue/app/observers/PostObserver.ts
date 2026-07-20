import { Str } from '@elyvel/support'
import { Post } from '../models/Post'

/**
 * Auto-generates a slug from the title whenever one isn't supplied — the
 * textbook use for `Model.observe()`. Registered in AppServiceProvider:
 *   Post.observe(new PostObserver())
 *
 * The `slug` field is still user-editable (StorePostRequest/UpdatePostRequest
 * validate it — regex + uniqueness — when non-empty); this only fills it in
 * when left blank, appending `-2`, `-3`, … on a collision so it never
 * silently violates the column's unique constraint.
 */
export class PostObserver {
  async creating(post: Post): Promise<void> {
    await this.deriveSlugIfBlank(post)
  }

  async updating(post: Post): Promise<void> {
    await this.deriveSlugIfBlank(post)
  }

  private async deriveSlugIfBlank(post: Post): Promise<void> {
    if (post.slug)
      return
    const base = Str.slug(post.title)
    let candidate = base
    for (let suffix = 2; await this.slugTaken(candidate, post.id); suffix++)
      candidate = `${base}-${suffix}`
    post.slug = candidate
  }

  private async slugTaken(slug: string, excludingId?: number): Promise<boolean> {
    const query = Post.query().where('slug', slug)
    if (excludingId !== undefined)
      query.where('id', '!=', excludingId)
    return query.exists()
  }
}

export default PostObserver
