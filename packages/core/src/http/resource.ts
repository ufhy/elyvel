/**
 * Lightweight API resource transformers (Laravel's API Resources). Shape a
 * model/collection into the `{ data, ... }` envelope the API lane returns —
 * the same transformer can also feed Inertia page props on the web lane.
 *
 * Conditional attributes (`when`, `whenLoaded`) let a transform omit fields:
 * they return a sentinel that the wrappers strip, so `{ admin: Resource.when(...) }`
 * disappears entirely rather than serializing `null`/`undefined`.
 *
 * Exposed as the `Resource` namespace to avoid clashing with the `resource()`
 * route helper.
 */

/** Sentinel for a conditionally-absent attribute; removed from the final output. */
const MISSING: unique symbol = Symbol('resource.missing')

/** Anything with an eager-loaded `relations` bag (structural — avoids a DB import). */
interface HasRelations {
  relations: Record<string, unknown>
}

/** Recursively drop keys whose value is the {@link MISSING} sentinel. */
function strip(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(strip)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      if (val === MISSING)
        continue
      out[key] = strip(val)
    }
    return out
  }
  return value
}

export const Resource = {
  /** Wrap a single item under `data`, optionally transforming it. */
  item<T>(item: T, transform?: (item: T) => unknown): { data: unknown } {
    return { data: transform ? strip(transform(item)) : item }
  },

  /** Wrap a list under `data`, optionally transforming each item. */
  collection<T>(items: T[], transform?: (item: T) => unknown): { data: unknown[] } {
    return { data: transform ? items.map(i => strip(transform(i))) : items }
  },

  /**
   * Wrap a paginator (any object with a `data` array) as `{ data, meta }`, where
   * `meta` is every other field on the paginator (total, perPage, currentPage…).
   */
  paginated<T>(
    paginator: { data: T[] } & Record<string, unknown>,
    transform?: (item: T) => unknown,
  ): { data: unknown[], meta: Record<string, unknown> } {
    const { data, ...meta } = paginator
    return { data: transform ? data.map(i => strip(transform(i))) : data, meta }
  },

  /**
   * Include a value only when `condition` is truthy, else omit the key. Pass a
   * thunk to defer computing an expensive value until the condition holds:
   * `role: Resource.when(user.isAdmin, () => user.role)`.
   */
  when<T>(condition: unknown, value: T | (() => T)): T | typeof MISSING {
    if (!condition)
      return MISSING
    return typeof value === 'function' ? (value as () => T)() : value
  },

  /**
   * Include a relation only when it has been eager-loaded, else omit the key —
   * so a resource never triggers a lazy N+1 query. Optionally transform it:
   * `posts: Resource.whenLoaded(user, 'posts', p => Resource.collection(p))`.
   */
  whenLoaded<T = unknown>(
    model: HasRelations,
    name: string,
    transform?: (value: T) => unknown,
  ): unknown {
    if (!(name in model.relations))
      return MISSING
    const value = model.relations[name] as T
    return transform ? transform(value) : value
  },
}
