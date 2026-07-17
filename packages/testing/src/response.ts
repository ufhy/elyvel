/**
 * A captured HTTP response with fluent, throw-on-failure assertions — the return
 * value of every {@link TestClient} call. Mirrors Laravel's `TestResponse`.
 *
 * The body is read once up front so assertions stay synchronous and chainable.
 */
export class TestResponse {
  readonly status: number
  readonly headers: Headers
  readonly body: string

  private constructor(status: number, headers: Headers, body: string) {
    this.status = status
    this.headers = headers
    this.body = body
  }

  /** Capture a fetch/Elysia `Response`, buffering its body. */
  static async of(response: Response): Promise<TestResponse> {
    return new TestResponse(response.status, response.headers, await response.text())
  }

  /** Parse the body as JSON. */
  json<T = unknown>(): T {
    try {
      return JSON.parse(this.body) as T
    }
    catch {
      throw new Error(`Response body is not valid JSON:\n${this.body.slice(0, 500)}`)
    }
  }

  /** The raw body text. */
  text(): string {
    return this.body
  }

  private fail(message: string): never {
    throw new Error(`${message}\n  status: ${this.status}\n  body: ${this.body.slice(0, 500)}`)
  }

  assertStatus(expected: number): this {
    if (this.status !== expected)
      this.fail(`Expected status ${expected}, got ${this.status}.`)
    return this
  }

  assertOk(): this {
    return this.assertStatus(200)
  }

  assertCreated(): this {
    return this.assertStatus(201)
  }

  assertNoContent(): this {
    return this.assertStatus(204)
  }

  assertNotFound(): this {
    return this.assertStatus(404)
  }

  assertUnauthorized(): this {
    return this.assertStatus(401)
  }

  assertForbidden(): this {
    return this.assertStatus(403)
  }

  /** Assert a 2xx status. */
  assertSuccessful(): this {
    if (this.status < 200 || this.status >= 300)
      this.fail(`Expected a 2xx status, got ${this.status}.`)
    return this
  }

  /** Assert a 3xx redirect, optionally to a specific `Location`. */
  assertRedirect(location?: string): this {
    if (this.status < 300 || this.status >= 400)
      this.fail(`Expected a redirect (3xx), got ${this.status}.`)
    if (location !== undefined && this.headers.get('location') !== location)
      this.fail(`Expected redirect to "${location}", got "${this.headers.get('location')}".`)
    return this
  }

  /** Assert a response header equals `value` (or is merely present when `value` is omitted). */
  assertHeader(name: string, value?: string): this {
    const actual = this.headers.get(name)
    if (actual === null)
      this.fail(`Expected header "${name}" to be present.`)
    if (value !== undefined && actual !== value)
      this.fail(`Expected header "${name}" to be "${value}", got "${actual}".`)
    return this
  }

  /** Assert the JSON body contains at least these keys/values (deep partial match). */
  assertJson(expected: Record<string, unknown>): this {
    const actual = this.json<Record<string, unknown>>()
    if (!containsSubset(actual, expected))
      this.fail(`JSON does not contain expected subset:\n  ${JSON.stringify(expected)}`)
    return this
  }

  /** Assert a dot-path in the JSON body equals `value`. */
  assertJsonPath(path: string, value: unknown): this {
    const actual = path.split('.').reduce<unknown>(
      (acc, key) => (acc == null ? undefined : (acc as Record<string, unknown>)[key]),
      this.json(),
    )
    if (JSON.stringify(actual) !== JSON.stringify(value))
      this.fail(`Expected JSON path "${path}" to be ${JSON.stringify(value)}, got ${JSON.stringify(actual)}.`)
    return this
  }

  /** Assert the body text contains `text`. */
  assertSee(text: string): this {
    if (!this.body.includes(text))
      this.fail(`Expected body to contain "${text}".`)
    return this
  }
}

/** Deep partial match: every key/value in `subset` appears in `value`. */
function containsSubset(value: unknown, subset: unknown): boolean {
  if (subset !== null && typeof subset === 'object') {
    if (value === null || typeof value !== 'object')
      return false
    if (Array.isArray(subset)) {
      if (!Array.isArray(value))
        return false
      return subset.every((s, i) => containsSubset(value[i], s))
    }
    return Object.entries(subset).every(([k, v]) =>
      containsSubset((value as Record<string, unknown>)[k], v),
    )
  }
  return JSON.stringify(value) === JSON.stringify(subset)
}
