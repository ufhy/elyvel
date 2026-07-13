/**
 * Lightweight API resource transformers (Laravel's API Resources). Shape a
 * model/collection into the `{ data, ... }` envelope the API lane returns —
 * the same transformer can also feed Inertia page props on the web lane.
 *
 * Exposed as the `Resource` namespace to avoid clashing with the `resource()`
 * route helper.
 */
export const Resource = {
  /** Wrap a single item under `data`, optionally transforming it. */
  item<T>(item: T, transform?: (item: T) => unknown): { data: unknown } {
    return { data: transform ? transform(item) : item }
  },

  /** Wrap a list under `data`, optionally transforming each item. */
  collection<T>(items: T[], transform?: (item: T) => unknown): { data: unknown[] } {
    return { data: transform ? items.map(transform) : items }
  },

  /**
   * Wrap a paginator (any object with a `data` array) as `{ data, meta }`, where
   * `meta` is every other field on the paginator (total, perPage, currentPage…).
   */
  paginated<T>(
    paginator: { data: T[] } & Record<string, unknown>,
    transform?: (item: T) => unknown,
  ): { data: unknown[]; meta: Record<string, unknown> } {
    const { data, ...meta } = paginator
    return { data: transform ? data.map(transform) : data, meta }
  },
}
