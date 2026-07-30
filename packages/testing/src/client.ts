import { TestResponse } from './response'

/**
 * Anything that can handle a `Request` — an elyvel `Application` or a bare
 * Elysia instance both satisfy this, so the client stays framework-decoupled.
 */
export interface Handleable {
  handle(request: Request): Promise<Response>
}

export interface RequestOptions {
  /** Extra headers for this request (merged over the client's defaults). */
  headers?: Record<string, string>
  /** JSON body — serialized and sent as `application/json`. */
  json?: unknown
  /** Raw body (string, FormData, Blob…) — use instead of `json`. */
  body?: RequestInit['body']
  /** Query parameters appended to the URL. */
  query?: Record<string, string | number | boolean>
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

const SAFE_METHODS = new Set<Method>(['GET', 'HEAD', 'OPTIONS'])

/** Parses the `name=value` pair out of a `Set-Cookie` string (ignores attributes). */
function cookiePair(setCookie: string): [string, string] | undefined {
  const raw = setCookie.split(';')[0] ?? ''
  const eq = raw.indexOf('=')
  if (eq === -1)
    return undefined
  return [raw.slice(0, eq), decodeURIComponent(raw.slice(eq + 1))]
}

/**
 * Is this `Set-Cookie` deleting the cookie? A browser removes it from the jar
 * entirely on `Max-Age=0` (or a past `Expires`); storing the empty value instead
 * meant the client kept sending `cookie: sess=` after a logout, and
 * `cookieJar()` still reported a cookie that no longer exists — so a test could
 * disagree with what a real browser would send.
 */
function isDeletion(setCookie: string): boolean {
  const attributes = setCookie.split(';').slice(1)
  for (const attribute of attributes) {
    const [rawName, rawValue = ''] = attribute.split('=')
    const name = rawName?.trim().toLowerCase()
    if (name === 'max-age' && Number(rawValue.trim()) <= 0)
      return true
    if (name === 'expires') {
      const expires = Date.parse(rawValue.trim())
      if (!Number.isNaN(expires) && expires <= Date.now())
        return true
    }
  }
  return false
}

/**
 * A fluent HTTP test client that drives an app through its `handle()` method —
 * no socket, no port. Every call resolves to a {@link TestResponse}.
 *
 * Carries a cookie jar like a browser would: every `Set-Cookie` the app sends
 * back is remembered and replayed on later requests from the same client —
 * session cookies just work across a multi-request flow (sign in, then act).
 * It also mirrors the readable `XSRF-TOKEN` cookie (set by the session
 * plugin) into an `X-XSRF-TOKEN` header on every non-GET request, the same
 * double-submit convention Inertia/axios use in a real browser — so testing
 * a CSRF-protected `POST`/`PUT`/`DELETE` needs no manual token plumbing:
 *
 *   const client = createTestClient(app)
 *   await client.get('/login')             // captures the session + XSRF cookies
 *   await client.post('/posts', { json })  // XSRF header attached automatically
 */
export class TestClient {
  private readonly baseUrl: string
  private readonly defaultHeaders: Record<string, string> = {}
  private readonly cookies = new Map<string, string>()

  constructor(private readonly app: Handleable, baseUrl = 'http://localhost') {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  /** Merge headers into every subsequent request (chainable). */
  withHeaders(headers: Record<string, string>): this {
    Object.assign(this.defaultHeaders, headers)
    return this
  }

  /** Set an `Authorization` header (Bearer by default). */
  withToken(token: string, scheme = 'Bearer'): this {
    return this.withHeaders({ authorization: `${scheme} ${token}` })
  }

  /** Seed a cookie (merges into the automatic jar — same as one set by the app). */
  withCookie(name: string, value: string): this {
    this.cookies.set(name, value)
    return this
  }

  /** Every cookie captured so far (from `withCookie` or a prior response's `Set-Cookie`). */
  cookieJar(): ReadonlyMap<string, string> {
    return this.cookies
  }

  /**
   * Act as `user` for every subsequent request on this client, via
   * `@elyvel/auth`'s test seam (`actingAs`) — dynamically imported so this
   * package stays usable without an auth dependency. Note that seam is
   * process-global, not per-client; call {@link stopActingAs} when done if
   * other clients/tests in the same run need to run unauthenticated.
   */
  async actingAs(user: unknown): Promise<this> {
    const { actingAs } = await import('@elyvel/auth')
    actingAs(user as never)
    return this
  }

  get(path: string, options?: RequestOptions): Promise<TestResponse> {
    return this.request('GET', path, options)
  }

  post(path: string, options?: RequestOptions): Promise<TestResponse> {
    return this.request('POST', path, options)
  }

  put(path: string, options?: RequestOptions): Promise<TestResponse> {
    return this.request('PUT', path, options)
  }

  patch(path: string, options?: RequestOptions): Promise<TestResponse> {
    return this.request('PATCH', path, options)
  }

  delete(path: string, options?: RequestOptions): Promise<TestResponse> {
    return this.request('DELETE', path, options)
  }

  head(path: string, options?: RequestOptions): Promise<TestResponse> {
    return this.request('HEAD', path, options)
  }

  async request(method: Method, path: string, options: RequestOptions = {}): Promise<TestResponse> {
    const url = new URL(this.baseUrl + (path.startsWith('/') ? path : `/${path}`))
    if (options.query) {
      for (const [key, value] of Object.entries(options.query))
        url.searchParams.set(key, String(value))
    }

    const headers = new Headers({ ...this.defaultHeaders, ...options.headers })
    if (this.cookies.size > 0 && !headers.has('cookie'))
      headers.set('cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '))
    if (!SAFE_METHODS.has(method) && !headers.has('x-xsrf-token')) {
      const xsrf = this.cookies.get('XSRF-TOKEN')
      if (xsrf)
        headers.set('x-xsrf-token', xsrf)
    }

    let body: RequestInit['body']
    if (options.json !== undefined) {
      body = JSON.stringify(options.json)
      if (!headers.has('content-type'))
        headers.set('content-type', 'application/json')
    }
    else if (options.body !== undefined) {
      body = options.body
    }

    const response = await this.app.handle(new Request(url.toString(), { method, headers, body }))
    for (const raw of response.headers.getSetCookie()) {
      const pair = cookiePair(raw)
      if (!pair)
        continue
      if (isDeletion(raw))
        this.cookies.delete(pair[0])
      else this.cookies.set(...pair)
    }
    return TestResponse.of(response)
  }
}

/** Build a {@link TestClient} for an app (or bare Elysia instance). */
export function createTestClient(app: Handleable, baseUrl?: string): TestClient {
  return new TestClient(app, baseUrl)
}
