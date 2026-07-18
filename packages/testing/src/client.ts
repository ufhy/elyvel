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

/**
 * A fluent HTTP test client that drives an app through its `handle()` method —
 * no socket, no port. Every call resolves to a {@link TestResponse}.
 */
export class TestClient {
  private readonly baseUrl: string
  private readonly defaultHeaders: Record<string, string> = {}

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

  /** Send a `Cookie` header. */
  withCookie(name: string, value: string): this {
    const existing = this.defaultHeaders.cookie
    const cookie = `${name}=${value}`
    this.defaultHeaders.cookie = existing ? `${existing}; ${cookie}` : cookie
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
    return TestResponse.of(response)
  }
}

/** Build a {@link TestClient} for an app (or bare Elysia instance). */
export function createTestClient(app: Handleable, baseUrl?: string): TestClient {
  return new TestClient(app, baseUrl)
}
