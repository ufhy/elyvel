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
    // Structural comparison, not `JSON.stringify` equality: stringify is
    // key-ORDER sensitive, so asserting `{ id: 1, name: 'Ada' }` against a body
    // that serialized `{ name: 'Ada', id: 1 }` failed a correct assertion.
    if (!deepEquals(actual, value))
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

/**
 * Deep partial match: every key/value in `subset` appears in `value`.
 *
 * An EMPTY expected array or object is the one exception — it asserts that the
 * actual value is empty too, rather than imposing no constraint. `every` over an
 * empty list is vacuously true, so `assertJson({ errors: [] })` used to PASS
 * while `errors` held two entries: a test written to prove there were no
 * validation errors passed precisely when there were. Laravel compares the value
 * at that point and fails, and so do we.
 */
function containsSubset(value: unknown, subset: unknown): boolean {
  if (subset !== null && typeof subset === 'object') {
    if (value === null || typeof value !== 'object')
      return false
    if (Array.isArray(subset)) {
      if (!Array.isArray(value))
        return false
      if (subset.length === 0)
        return value.length === 0
      return subset.every((s, i) => containsSubset(value[i], s))
    }
    if (Array.isArray(value))
      return false
    const keys = Object.keys(subset)
    if (keys.length === 0)
      return Object.keys(value).length === 0
    return keys.every(k =>
      containsSubset(
        (value as Record<string, unknown>)[k],
        (subset as Record<string, unknown>)[k],
      ),
    )
  }
  return JSON.stringify(value) === JSON.stringify(subset)
}

/** Structural equality over JSON values — key order does not matter. */
function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b)
    return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object')
    return JSON.stringify(a) === JSON.stringify(b)
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
      return false
    return a.every((item, i) => deepEquals(item, b[i]))
  }
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length)
    return false
  return aKeys.every(k =>
    Object.hasOwn(b, k)
    && deepEquals((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  )
}
