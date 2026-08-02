/**
 * name → path template (e.g. `users.show` → `/users/:id`). One Application
 * per process, by design — same assumption as `middleware.ts`'s alias/group
 * registries (see the comment there). Booting a second Application in the
 * same process would clobber this and could make `urlFor()` resolve to the
 * wrong app's URL shape.
 */
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
    throw new Error(`[elyvel] No named route "${name}".`)
  }
  const used = new Set<string>()
  const path = template.replace(/:(\w+)\??/g, (_match, key: string) => {
    used.add(key)
    const value = params[key]
    if (value === undefined) {
      throw new Error(`[elyvel] Missing parameter "${key}" for route "${name}".`)
    }
    return encodeURIComponent(String(value))
  })
  const extras = Object.entries(params).filter(([key]) => !used.has(key))
  if (extras.length === 0)
    return path
  const query = extras
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&')
  return `${path}?${query}`
}

// ── Signed URLs ─────────────────────────────────────────────────────────────

/**
 * A URL that carries proof it was issued by this application: an HMAC over the
 * URL itself, appended as `signature`. Laravel's `URL::signedRoute()`.
 *
 * The point is a link that authenticates the ACTION rather than the person — an
 * unsubscribe link in an email, a download that must not be guessable, an
 * invitation. The alternative people reach for is a random token in a database
 * table, which needs a table, a lookup, and a cleanup job to do the same job.
 *
 * Parameters are sorted before signing, so a link survives a mail client or
 * proxy that reorders the query string. `expires` and `signature` are reserved.
 */
const RESERVED_SIGNED_PARAMS = ['signature', 'expires']

let signingKeyResolver: (() => string | undefined) | undefined

/**
 * Where the signing key comes from. Set by the Application at boot from
 * `app.key`; tests and standalone use can set it directly.
 */
export function setUrlSigningKey(resolver: (() => string | undefined) | string | undefined): void {
  signingKeyResolver = typeof resolver === 'string' ? () => resolver : resolver
}

function signingKey(): string {
  const key = signingKeyResolver?.()
  if (!key) {
    throw new Error(
      '[elyvel] Signed URLs need a key — set `app.key` (e.g. via APP_KEY) or call setUrlSigningKey().',
    )
  }
  return key
}

/** HMAC-SHA256 of `value`, hex-encoded. */
function sign(value: string): string {
  return new Bun.CryptoHasher('sha256', signingKey()).update(value).digest('hex')
}

/** Constant-time compare, so a wrong signature can't be found byte by byte. */
function signaturesMatch(a: string, b: string): boolean {
  if (a.length !== b.length)
    return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export interface SignedUrlOptions {
  /** Absolute expiry. Without one the link never expires. */
  expiresAt?: Date
  /** Convenience alternative to `expiresAt`. */
  expiresInSeconds?: number
}

/**
 * A signed URL for a named route.
 *
 * ```ts
 * signedUrl('unsubscribe', { user: 42 }, { expiresInSeconds: 60 * 60 * 24 * 7 })
 * // /unsubscribe/42?expires=1767225600&signature=9f86d0…
 * ```
 */
export function signedUrl(
  name: string,
  params: Record<string, string | number> = {},
  options: SignedUrlOptions = {},
): string {
  for (const reserved of RESERVED_SIGNED_PARAMS) {
    if (reserved in params) {
      throw new Error(
        `[elyvel] "${reserved}" is reserved on a signed URL — it is part of the signature.`,
      )
    }
  }

  const expires = options.expiresAt
    ? Math.floor(options.expiresAt.getTime() / 1000)
    : options.expiresInSeconds !== undefined
      ? Math.floor(Date.now() / 1000) + options.expiresInSeconds
      : undefined

  // Sorted, so a client or proxy that reorders the query string doesn't
  // invalidate the link — Laravel ksorts for the same reason.
  const signedParams: Record<string, string | number> = { ...params }
  if (expires !== undefined)
    signedParams.expires = expires
  const ordered = Object.fromEntries(Object.entries(signedParams).sort(([a], [b]) => a.localeCompare(b)))

  const url = urlFor(name, ordered)
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}signature=${sign(url)}`
}

/**
 * Does this URL carry a signature this application issued, and is it still
 * valid? Pass the request URL (absolute or path+query).
 *
 * Returns false rather than throwing: an invalid signature is untrusted input on
 * a public endpoint, and a 500 there is a denial-of-service someone else
 * controls.
 */
export function hasValidSignature(requestUrl: string | URL): boolean {
  const url = typeof requestUrl === 'string'
    ? new URL(requestUrl, 'http://localhost')
    : requestUrl

  const provided = url.searchParams.get('signature')
  if (!provided)
    return false

  const expires = url.searchParams.get('expires')
  if (expires !== null) {
    const at = Number(expires)
    if (!Number.isFinite(at) || at * 1000 < Date.now())
      return false
  }

  // Rebuild exactly what was signed: same path, same params minus `signature`,
  // in the same sorted order.
  const params = [...url.searchParams.entries()]
    .filter(([key]) => key !== 'signature')
    .sort(([a], [b]) => a.localeCompare(b))
  const query = params
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  const original = query ? `${url.pathname}?${query}` : url.pathname

  try {
    return signaturesMatch(sign(original), provided)
  }
  catch {
    // No signing key configured — nothing can be valid.
    return false
  }
}
