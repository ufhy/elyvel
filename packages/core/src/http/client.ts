/**
 * Outbound HTTP client — Laravel's `Http` facade over `fetch`. Fluent config
 * (headers, base URL, timeout, retry) and a `HttpResponse` with status helpers.
 *
 *   const res = await Http.withToken(t).timeout(5000).retry(3, 100).get('https://api/x')
 *   if (res.ok) return res.json()
 *
 * `Http.fake()` swaps the transport for tests — no network, with recorded
 * requests and canned responses.
 */

export interface FakeResponse {
  status?: number
  json?: unknown
  body?: string
  headers?: Record<string, string>
}

interface RecordedRequest {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}

// Test transport: url-glob → canned response. `null` means "not faking".
let fakes: Map<string, FakeResponse> | null = null
const recorded: RecordedRequest[] = []

/** A captured HTTP response with status/parse helpers. */
export class HttpResponse {
  constructor(
    readonly status: number,
    readonly headers: Headers,
    private readonly bodyText: string,
  ) {}

  get ok(): boolean {
    return this.status >= 200 && this.status < 300
  }

  get failed(): boolean {
    return !this.ok
  }

  get clientError(): boolean {
    return this.status >= 400 && this.status < 500
  }

  get serverError(): boolean {
    return this.status >= 500
  }

  json<T = unknown>(): T {
    return JSON.parse(this.bodyText) as T
  }

  text(): string {
    return this.bodyText
  }

  /** Throw when the response is not 2xx (Laravel's `->throw()`). */
  throwIfFailed(): this {
    if (this.failed)
      throw new Error(`HTTP request failed with status ${this.status}: ${this.bodyText.slice(0, 300)}`)
    return this
  }
}

/** A configured, not-yet-sent request. Immutable-ish: each `with*` returns a clone. */
export class PendingRequest {
  private headers: Record<string, string> = {}
  private baseUrl = ''
  private timeoutMs: number | null = null
  private retries = 0
  private retryDelayMs = 0

  private clone(): PendingRequest {
    const next = new PendingRequest()
    next.headers = { ...this.headers }
    next.baseUrl = this.baseUrl
    next.timeoutMs = this.timeoutMs
    next.retries = this.retries
    next.retryDelayMs = this.retryDelayMs
    return next
  }

  withHeaders(headers: Record<string, string>): PendingRequest {
    const next = this.clone()
    Object.assign(next.headers, headers)
    return next
  }

  withToken(token: string, scheme = 'Bearer'): PendingRequest {
    return this.withHeaders({ authorization: `${scheme} ${token}` })
  }

  withBaseUrl(url: string): PendingRequest {
    const next = this.clone()
    next.baseUrl = url.replace(/\/$/, '')
    return next
  }

  /** Abort the request after `ms` milliseconds. */
  timeout(ms: number): PendingRequest {
    const next = this.clone()
    next.timeoutMs = ms
    return next
  }

  /** Retry a failed/errored request up to `times`, waiting `delayMs` between tries. */
  retry(times: number, delayMs = 0): PendingRequest {
    const next = this.clone()
    next.retries = times
    next.retryDelayMs = delayMs
    return next
  }

  get(url: string): Promise<HttpResponse> {
    return this.send('GET', url)
  }

  delete(url: string, data?: unknown): Promise<HttpResponse> {
    return this.send('DELETE', url, data)
  }

  post(url: string, data?: unknown): Promise<HttpResponse> {
    return this.send('POST', url, data)
  }

  put(url: string, data?: unknown): Promise<HttpResponse> {
    return this.send('PUT', url, data)
  }

  patch(url: string, data?: unknown): Promise<HttpResponse> {
    return this.send('PATCH', url, data)
  }

  async send(method: string, url: string, data?: unknown): Promise<HttpResponse> {
    const fullUrl = this.baseUrl && !/^https?:\/\//.test(url) ? `${this.baseUrl}/${url.replace(/^\//, '')}` : url
    const headers = { ...this.headers }
    let body: string | undefined
    if (data !== undefined) {
      body = typeof data === 'string' ? data : JSON.stringify(data)
      if (typeof data !== 'string' && !hasHeader(headers, 'content-type'))
        headers['content-type'] = 'application/json'
    }

    let lastError: unknown
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const response = await this.dispatch(method, fullUrl, headers, body)
        // Retry server errors when retries remain; return otherwise.
        if (response.serverError && attempt < this.retries) {
          await sleep(this.retryDelayMs)
          continue
        }
        return response
      }
      catch (error) {
        lastError = error
        if (attempt < this.retries) {
          await sleep(this.retryDelayMs)
          continue
        }
      }
    }
    throw lastError
  }

  private async dispatch(
    method: string,
    url: string,
    headers: Record<string, string>,
    body: string | undefined,
  ): Promise<HttpResponse> {
    if (fakes) {
      recorded.push({ method, url, headers, body })
      const fake = matchFake(url)
      const status = fake?.status ?? 200
      const text = fake?.body ?? (fake?.json !== undefined ? JSON.stringify(fake.json) : '')
      const h = new Headers(fake?.headers ?? { 'content-type': 'application/json' })
      return new HttpResponse(status, h, text)
    }

    const controller = this.timeoutMs != null ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs!) : null
    try {
      const res = await fetch(url, { method, headers, body, signal: controller?.signal })
      return new HttpResponse(res.status, res.headers, await res.text())
    }
    finally {
      if (timer)
        clearTimeout(timer)
    }
  }
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some(k => k.toLowerCase() === name.toLowerCase())
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve()
}

/** Match a recorded URL against a fake glob pattern (`*` wildcard). */
function matchFake(url: string): FakeResponse | undefined {
  if (!fakes)
    return undefined
  for (const [pattern, response] of fakes) {
    if (pattern === '*')
      return response
    const regex = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*')}$`)
    if (regex.test(url) || regex.test(url.replace(/^https?:\/\//, '')))
      return response
  }
  return undefined
}

/**
 * The `Http` facade: start a request with any fluent method, or use a verb
 * shortcut directly. Testing: `Http.fake({...})`, `Http.recorded()`,
 * `Http.assertSent(fn)`, `Http.stopFaking()`.
 */
export const Http = {
  withHeaders: (headers: Record<string, string>) => new PendingRequest().withHeaders(headers),
  withToken: (token: string, scheme?: string) => new PendingRequest().withToken(token, scheme),
  withBaseUrl: (url: string) => new PendingRequest().withBaseUrl(url),
  timeout: (ms: number) => new PendingRequest().timeout(ms),
  retry: (times: number, delayMs?: number) => new PendingRequest().retry(times, delayMs),
  get: (url: string) => new PendingRequest().get(url),
  post: (url: string, data?: unknown) => new PendingRequest().post(url, data),
  put: (url: string, data?: unknown) => new PendingRequest().put(url, data),
  patch: (url: string, data?: unknown) => new PendingRequest().patch(url, data),
  delete: (url: string, data?: unknown) => new PendingRequest().delete(url, data),

  /**
   * Swap the transport for tests: no network, canned responses keyed by url glob
   * (`*` wildcard, or `'*'` for all), and every request recorded.
   */
  fake(responses: Record<string, FakeResponse> = { '*': {} }): void {
    fakes = new Map(Object.entries(responses))
    recorded.length = 0
  },

  /** Restore the real `fetch` transport. */
  stopFaking(): void {
    fakes = null
    recorded.length = 0
  },

  /** All requests captured while faking. */
  recorded(): readonly RecordedRequest[] {
    return recorded
  },

  /** Assert at least one recorded request matches `predicate`. */
  assertSent(predicate: (request: RecordedRequest) => boolean): void {
    if (!recorded.some(predicate))
      throw new Error('Expected an HTTP request matching the predicate, but none was sent.')
  },

  /** Assert no requests were sent. */
  assertNothingSent(): void {
    if (recorded.length > 0)
      throw new Error(`Expected no HTTP requests, but ${recorded.length} were sent.`)
  },
}
