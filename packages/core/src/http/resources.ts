/**
 * API resources — the transformation layer between a model and the JSON your API
 * returns (Laravel's `JsonResource`). Without one, controllers either return
 * models directly (leaking every column the moment someone adds one) or hand-roll
 * an object literal per endpoint, which drifts between the list and detail views
 * of the same thing.
 */

/**
 * A value that should not appear in the output at all — Laravel's `MissingValue`.
 * Distinct from `null`, which is a value the client sees: `when(false, …)` must
 * omit the key, not send `"key": null`.
 */
const MISSING = Symbol('elyvel.resource.missing')

/** Marks an object whose entries are spread into the parent when included. */
interface MergeMarker {
  [MERGE]: Record<string, unknown>
}
const MERGE = Symbol('elyvel.resource.merge')

function isMerge(value: unknown): value is MergeMarker {
  return typeof value === 'object' && value !== null && MERGE in value
}

/**
 * Drops missing values and flattens merges, at every level — a resource that
 * nests another resource's output must filter that too, or the sentinel leaks
 * into the response as an unserialisable symbol.
 */
function filterMissing(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === MISSING)
      continue
    if (isMerge(value)) {
      Object.assign(out, filterMissing(value[MERGE]))
      continue
    }
    out[key] = value
  }
  return out
}

/** Minimal shape of an Eloquent model, so this file needn't depend on the ORM. */
interface WithRelations {
  relations?: Record<string, unknown>
}

/**
 * Base class for a single-object resource.
 *
 * ```ts
 * class UserResource extends JsonResource<User> {
 *   toArray() {
 *     return {
 *       id: this.resource.id,
 *       name: this.resource.name,
 *       email: this.when(this.resource.id === currentUserId(), this.resource.email),
 *       posts: this.whenLoaded('posts', () => PostResource.collection(this.resource.relations.posts)),
 *     }
 *   }
 * }
 * ```
 */
export abstract class JsonResource<T = unknown> {
  /** Default envelope key for every resource. Override per class, or per call. */
  static wrap: string | null = 'data'

  private extra: Record<string, unknown> = {}
  private wrapOverride: string | null | undefined

  constructor(readonly resource: T) {}

  /** The shape this resource serialises to. Values may be `when(...)` results. */
  abstract toArray(): Record<string, unknown>

  /** `UserResource.make(user)` — reads better than `new UserResource(user)` in a return. */
  static make<T, R extends JsonResource<T>>(
    this: new (resource: T, ...rest: never[]) => R,
    resource: T,
  ): R {
    return new this(resource)
  }

  /** Wrap a list of items in this resource: `UserResource.collection(users)`. */
  static collection<T, R extends JsonResource<T>>(
    this: new (resource: T, ...rest: never[]) => R,
    items: Iterable<T>,
  ): ResourceCollection<R> {
    return new ResourceCollection([...items].map(item => new this(item)))
  }

  /** Top-level data merged into the response alongside the payload (`meta`, `links`). */
  additional(data: Record<string, unknown>): this {
    this.extra = { ...this.extra, ...data }
    return this
  }

  /** Override the envelope for this instance. `null` sends the payload bare. */
  wrapIn(key: string | null): this {
    this.wrapOverride = key
    return this
  }

  /** The filtered payload, without the envelope. */
  resolve(): Record<string, unknown> {
    return filterMissing(this.toArray())
  }

  /**
   * What the framework serialises. Returning this from a route handler is enough
   * — no `.toJSON()` call at the call site.
   */
  toJSON(): Record<string, unknown> {
    const key = this.wrapOverride !== undefined
      ? this.wrapOverride
      : (this.constructor as typeof JsonResource).wrap
    const payload = this.resolve()
    return key === null ? { ...payload, ...this.extra } : { [key]: payload, ...this.extra }
  }

  /** Include the value only when `condition` holds; otherwise omit the key entirely. */
  protected when<V>(condition: boolean, value: V | (() => V), fallback?: unknown): unknown {
    if (condition)
      return typeof value === 'function' ? (value as () => V)() : value
    return fallback === undefined ? MISSING : fallback
  }

  /** Include only when the value isn't null/undefined. */
  protected whenNotNull<V>(value: V, fallback?: unknown): unknown {
    if (value !== null && value !== undefined)
      return value
    // Written as a statement on purpose: an earlier one-liner here was rewritten
    // by `eslint --fix` into `value ?? fallback === undefined ? MISSING : fallback`,
    // which parses as `(value ?? (fallback === undefined)) ? ...` and drops every
    // value it was supposed to keep.
    return fallback === undefined ? MISSING : fallback
  }

  /**
   * Include only when the relation was actually eager-loaded.
   *
   * This is the one that prevents an N+1 hiding inside a serialiser: reading
   * `user.posts` unconditionally would issue a query per user, invisibly, from
   * the place least likely to be profiled.
   */
  protected whenLoaded<V>(relation: string, value?: V | (() => V), fallback?: unknown): unknown {
    const relations = (this.resource as WithRelations)?.relations
    if (!relations || !Object.hasOwn(relations, relation))
      return fallback === undefined ? MISSING : fallback
    if (value === undefined)
      return relations[relation]
    return typeof value === 'function' ? (value as () => V)() : value
  }

  /** Spread these keys into the parent object when the condition holds. */
  protected mergeWhen(condition: boolean, value: Record<string, unknown> | (() => Record<string, unknown>)): unknown {
    if (!condition)
      return MISSING
    return { [MERGE]: typeof value === 'function' ? value() : value }
  }
}

/** A list of resources, sharing one envelope and optional `meta`. */
export class ResourceCollection<R extends { resolve(): Record<string, unknown> } = JsonResource<never>> {
  private extra: Record<string, unknown> = {}
  private wrapOverride: string | null | undefined

  constructor(readonly items: R[]) {}

  /** Top-level data alongside the list — pagination `meta`, `links`. */
  additional(data: Record<string, unknown>): this {
    this.extra = { ...this.extra, ...data }
    return this
  }

  /** Override the envelope for this collection. `null` returns a bare array. */
  wrapIn(key: string | null): this {
    this.wrapOverride = key
    return this
  }

  /** The filtered payloads, without the envelope. */
  resolve(): Record<string, unknown>[] {
    return this.items.map(item => item.resolve())
  }

  toJSON(): Record<string, unknown> | Record<string, unknown>[] {
    const first = this.items[0]
    const key = this.wrapOverride !== undefined
      ? this.wrapOverride
      : (first ? (first.constructor as typeof JsonResource).wrap : JsonResource.wrap)
    const payload = this.resolve()
    return key === null ? payload : { [key]: payload, ...this.extra }
  }
}
