/**
 * Content negotiation — decides whether a request wants a JSON (API) response
 * or an HTML/web response (redirects, views). This is the single switch that
 * lets one controller serve both the API-first and full-stack lanes.
 */
export function expectsJson(request: Request): boolean {
  // Explicit AJAX clients.
  if ((request.headers.get('x-requested-with') ?? '').toLowerCase() === 'xmlhttprequest') return true
  // Inertia is a web (HTML/SPA) posture, handled separately — never plain JSON here.
  if (request.headers.get('x-inertia')) return false

  const accept = request.headers.get('accept') ?? ''
  if (accept.includes('application/json')) return true
  if (accept.includes('text/html') || accept.includes('application/xhtml')) return false

  // No decisive Accept header: fall back to the request body's content type.
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) return true

  // Default to the web (HTML) lane so browsers get redirects, not JSON.
  return false
}

/** The inverse of {@link expectsJson} — the request wants an HTML/web response. */
export function wantsHtml(request: Request): boolean {
  return !expectsJson(request)
}
