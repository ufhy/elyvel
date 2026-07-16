/**
 * HTTP method spoofing (Laravel's `@method`). HTML forms can only POST, so a
 * hidden `_method` field (or `?_method=` query, or `X-HTTP-Method-Override`
 * header) lets a POST stand in for PUT/PATCH/DELETE. Applied before routing so
 * the request reaches the correctly-typed route.
 */
const SPOOFABLE = new Set(['PUT', 'PATCH', 'DELETE'])

function normalize(value: string | null | undefined): string | undefined {
  const method = value?.toUpperCase()
  return method && SPOOFABLE.has(method) ? method : undefined
}

/** Return a request with its method rewritten from `_method`/header, or the original. */
export async function methodOverride(request: Request): Promise<Request> {
  if (request.method !== 'POST')
    return request

  // Header / query — no need to touch the body.
  const fromHeader = normalize(request.headers.get('x-http-method-override'))
  if (fromHeader)
    return new Request(request, { method: fromHeader })

  const fromQuery = normalize(new URL(request.url).searchParams.get('_method'))
  if (fromQuery)
    return new Request(request, { method: fromQuery })

  // Body `_method` — only for HTML form posts (urlencoded). JSON API requests are
  // left untouched (they use a real method or the X-HTTP-Method-Override header),
  // so their body is never consumed/reconstructed here.
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.includes('x-www-form-urlencoded'))
    return request

  const body = await request.arrayBuffer()
  let fromBody: string | undefined
  try {
    fromBody = normalize(new URLSearchParams(new TextDecoder().decode(body)).get('_method'))
  }
  catch {
    // malformed body — leave the method as POST
  }
  return new Request(request.url, { method: fromBody ?? 'POST', headers: request.headers, body })
}
