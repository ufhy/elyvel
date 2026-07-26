import type { EloquentBuilder } from './eloquent-builder'
import type { Cast, Model } from './model'
import type { QueryBuilder } from './query-builder'

/**
 * A model concern — Laravel trait equivalent, plain-object form. Bundle a
 * reusable column + fillable/cast/scope set (e.g. "every model with a status
 * column") and apply it with {@link withConcerns}, instead of repeating the
 * same `fillable`/`casts`/`scopes` entries on every model that needs them.
 *
 * Pair each concern with a same-named `*Fields` interface and merge it onto
 * the model (`interface Post extends HasStatusFields {}`) for typed field
 * access — see the "Model Concerns" guide for the full recipe.
 */
export interface Concern {
  fillable?: string[]
  casts?: Record<string, Cast>
  /** Opt-in — applied via `.scope('name')`. */
  scopes?: Record<string, (q: EloquentBuilder<any>, ...args: any[]) => void>
  /**
   * Auto-applied to every query for the model (Laravel's `bootX()` registering
   * a global scope). Note the narrower surface: global scopes operate on the
   * raw `QueryBuilder`, not the Eloquent-aware `EloquentBuilder` local scopes get.
   */
  globalScopes?: Record<string, (q: QueryBuilder) => void>
  /** Instance methods, merged onto the model's prototype. */
  methods?: Record<string, (this: any, ...args: any[]) => unknown>
}

/**
 * Apply one or more {@link Concern}s to a Model class (Laravel's `use HasX, HasY;`).
 * Merges `fillable`/`casts`/`scopes` and registers `globalScopes`/`methods` — call
 * once, right after the class declaration:
 *
 *   interface Post extends HasStatusFields {}
 *   class Post extends Model { static override table = 'posts' }
 *   withConcerns(Post, HasStatus)
 */
export function withConcerns(target: typeof Model, ...concerns: Concern[]): void {
  for (const concern of concerns) {
    if (concern.fillable)
      target.fillable = [...target.fillable, ...concern.fillable]
    if (concern.casts)
      target.casts = { ...target.casts, ...concern.casts }
    if (concern.scopes)
      target.scopes = { ...target.scopes, ...concern.scopes }
    if (concern.globalScopes) {
      for (const [name, scope] of Object.entries(concern.globalScopes))
        target.addGlobalScope(name, scope)
    }
    if (concern.methods)
      Object.assign(target.prototype, concern.methods)
  }
}
