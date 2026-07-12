/** name → path template (e.g. `users.show` → `/users/:id`). */
const routeNames = new Map<string, string>()

/** Register a named route template. */
export function named(name: string, template: string): void {
  routeNames.set(name, template)
}

/** Register several named routes at once. */
export function registerRouteNames(entries: Record<string, string>): void {
  for (const [name, template] of Object.entries(entries)) routeNames.set(name, template)
}

/** All registered names (for tooling like `route:list`). */
export function routeNameEntries(): [string, string][] {
  return [...routeNames.entries()]
}

export function clearRouteNames(): void {
  routeNames.clear()
}

/**
 * Generate a URL for a named route, à la Laravel's `route()` helper. Named after
 * `urlFor` to avoid colliding with the {@link route} router factory.
 *
 *   named('users.show', '/users/:id')
 *   urlFor('users.show', { id: 1 })            // "/users/1"
 *   urlFor('users.index', { page: 2 })         // "/users?page=2" (extras → query)
 */
export function urlFor(name: string, params: Record<string, string | number> = {}): string {
  const template = routeNames.get(name)
  if (!template) {
    throw new Error(`[elysia-ravel] No named route "${name}".`)
  }
  const used = new Set<string>()
  const path = template.replace(/:([A-Za-z0-9_]+)\??/g, (_match, key: string) => {
    used.add(key)
    const value = params[key]
    if (value === undefined) {
      throw new Error(`[elysia-ravel] Missing parameter "${key}" for route "${name}".`)
    }
    return encodeURIComponent(String(value))
  })
  const extras = Object.entries(params).filter(([key]) => !used.has(key))
  if (extras.length === 0) return path
  const query = extras
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&')
  return `${path}?${query}`
}
