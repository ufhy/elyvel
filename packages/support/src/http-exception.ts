/**
 * The marker that tells the error renderer "this exception was authored to be
 * shown to a client".
 *
 * `Symbol.for` (the global registry) rather than a module-local `Symbol()`, and
 * a marker rather than `instanceof`, for two reasons:
 *
 *  - `@elyvel/validation` doesn't depend on `@elyvel/core`, so there is no single
 *    class both the renderer and every thrower can reach by identity.
 *  - `instanceof` silently fails when a monorepo or an npm dedupe miss leaves two
 *    copies of this package in the tree; a registry symbol matches across them.
 *
 * A third-party error can't acquire this by accident — which is the entire point,
 * since the renderer used to trust any object that merely happened to have a
 * numeric `status`.
 */
export const HTTP_EXCEPTION = Symbol.for('elyvel.httpException')

/** What the error renderer may safely read off a client-facing exception. */
export interface HttpExceptionLike {
  readonly status: number
  readonly message: string
  /** Field-level errors (validation), rendered under `errors` in JSON. */
  readonly errors?: unknown
}

/**
 * An exception whose status and message are meant for the client.
 *
 * Throw this when you want a specific HTTP status and a message the user should
 * see:
 *
 * ```ts
 * throw new HttpException(404, 'That post has been removed.')
 * ```
 *
 * Anything NOT marked this way is treated as an internal fault: the renderer
 * answers 500 with a generic message, regardless of what properties the error
 * happens to carry. Attaching `status` to an arbitrary error used to be enough to
 * pick your own status code AND have your message echoed verbatim — so an
 * outbound HTTP client or database driver rejection (they routinely carry a
 * numeric `status`) was relayed to the client as a plausible-looking 4xx,
 * complete with internal hostnames, connection strings and query-string
 * credentials.
 */
export class HttpException extends Error implements HttpExceptionLike {
  readonly status: number
  readonly errors?: unknown

  constructor(status: number, message: string, errors?: unknown) {
    super(message)
    this.name = 'HttpException'
    this.status = status
    if (errors !== undefined)
      this.errors = errors
  }
}

// Mark the prototype once, so every subclass inherits it without repeating the
// property. Non-enumerable so it never shows up in JSON or object spreads.
Object.defineProperty(HttpException.prototype, HTTP_EXCEPTION, {
  value: true,
  enumerable: false,
})

/**
 * Is this a client-facing exception whose status/message may be rendered?
 *
 * Checks the marker AND that `status` really is a number, so a subclass that
 * forgets to set one can't produce `NaN`/`undefined` as an HTTP status.
 */
export function isHttpException(value: unknown): value is HttpExceptionLike {
  if (value === null || typeof value !== 'object')
    return false
  if ((value as Record<PropertyKey, unknown>)[HTTP_EXCEPTION] !== true)
    return false
  return typeof (value as { status?: unknown }).status === 'number'
}
