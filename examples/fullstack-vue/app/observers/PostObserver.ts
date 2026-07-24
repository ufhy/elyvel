import type { ModelObserver } from '@elyvel/database'
import { Str } from '@elyvel/support'
import { Post } from '../models/Post'

/** After this many numbered collisions, fall back to a random suffix instead of looping forever. */
const MAX_NUMBERED_ATTEMPTS = 20

/**
 * Auto-generates a slug from the title whenever one isn't supplied — the
 * textbook use for `Model.observe()`. Registered in AppServiceProvider:
 *   Post.observe(new PostObserver())
 *
 * The `slug` field is still user-editable (StorePostRequest/UpdatePostRequest
 * validate it — regex + uniqueness — when non-empty); this only fills it in
 * when left blank, appending `-2`, `-3`, … on a collision so it never
 * silently violates the column's unique constraint.
 *
 * Two accepted, narrow caveats (not fixed here — matches how this codebase
 * treats the same tradeoffs elsewhere):
 * - `slugTaken()` is check-then-insert (TOCTOU): two concurrent creates with
 *   the identical title could both pass the check before either INSERT
 *   commits, and the second would hit the column's real unique constraint.
 *   Same class of race the `unique` validation rule already has everywhere
 *   in this framework.
 * - `AppServiceProvider.boot()` (and therefore `Post.observe(new PostObserver())`)
 *   reruns on every `createApp()` in the same process — unlike
 *   `gate().policy()` (Map-keyed, overwrites), `Model.on()` appends, so
 *   repeated boots pile up duplicate listeners. Harmless here only because
 *   `deriveSlugIfBlank` checks `if (post.slug) return` before doing anything,
 *   so re-firings are no-ops; a differently-written observer (e.g. one that
 *   sends a notification) would need its own idempotency guard to be safe
 *   under repeated boots.
 */
export class PostObserver implements ModelObserver<Post> {
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
    let suffix = 2
    while (await this.slugTaken(candidate, post.id)) {
      // Give up on sequential numbering past MAX_NUMBERED_ATTEMPTS (a title
      // colliding with -2 through -N is only realistic with adversarial/bulk
      // data) and use a short random suffix instead, so this can't loop forever.
      candidate = suffix <= MAX_NUMBERED_ATTEMPTS ? `${base}-${suffix}` : `${base}-${Str.random(6).toLowerCase()}`
      suffix++
    }
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
