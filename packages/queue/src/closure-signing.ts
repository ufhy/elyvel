/**
 * Integrity for queued closures.
 *
 * A queued closure travels as its own **source text** and is rebuilt on the
 * worker with `new Function(...)`. Without a signature, anyone who can write a
 * row into the queue store — a compromised database account, an unauthenticated
 * Redis, a SQL injection elsewhere in the app — turns that write into arbitrary
 * code execution inside the worker process. The queue is not a trust boundary
 * by itself.
 *
 * So the source is signed at dispatch with an HMAC keyed by `app.key`, and
 * verified before it is ever handed to `new Function`. This is exactly what
 * Laravel does: `SerializableClosure::setSecretKey($config['key'])`, with a
 * `hash_hmac('sha256', …)` signature and a constant-time comparison.
 *
 * Only closures need this. A normal `Job` carries data, not code — the worker
 * looks its class up in a registry it already trusts.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

let secret: string | null = null

/**
 * Set the signing key — the queue provider passes `app.key`. Clearing it (null)
 * is for tests.
 */
export function setClosureSigningKey(key: string | null): void {
  secret = key !== null && key !== '' ? key : null
}

/** Is closure signing available at all? */
export function hasClosureSigningKey(): boolean {
  return secret !== null
}

const NO_KEY
  = '[elyvel] Queued closures need an application key to be signed. Set APP_KEY '
    + '(`elyvel key:generate`), or queue a Job class instead — an unsigned closure '
    + 'lets anyone who can write to the queue run code in your worker.'

/** HMAC-SHA256 of the source, base64. */
function digest(source: string): string {
  if (secret === null)
    throw new Error(NO_KEY)
  return createHmac('sha256', secret).update(source).digest('base64')
}

/** Sign closure source at dispatch. Throws when no key is configured. */
export function signClosure(source: string): string {
  return digest(source)
}

/**
 * Signature and source in ONE string, `<base64 hmac>.<source>`. Batch
 * callbacks are persisted through an app-supplied adapter, so adding sibling
 * signature fields would break every existing adapter; a self-contained
 * envelope needs no schema change. `.` is safe as the separator — it is not in
 * the base64 alphabet, so the first one always ends the signature.
 */
export function packSignedClosure(source: string): string {
  return `${digest(source)}.${source}`
}

/** Verify a packed closure and return its source, or throw. */
export function unpackSignedClosure(packed: string): string {
  const separator = packed.indexOf('.')
  // No separator at all means it predates signing (or was hand-written into
  // the store) — `verifyClosure` turns that into the right error.
  const signature = separator === -1 ? undefined : packed.slice(0, separator)
  const source = separator === -1 ? packed : packed.slice(separator + 1)
  verifyClosure(source, signature)
  return source
}

/**
 * Verify source against its signature, or throw. Fails closed on every path:
 * no key, no signature, or a mismatch — because each of those is
 * indistinguishable from a payload someone injected.
 */
export function verifyClosure(source: string, signature: string | undefined): void {
  if (secret === null)
    throw new Error(NO_KEY)
  if (!signature) {
    throw new Error(
      '[elyvel] Refusing to run an unsigned queued closure. It was queued before '
      + 'signing existed, or it did not come from this application.',
    )
  }

  const expected = Buffer.from(digest(source))
  const actual = Buffer.from(signature)
  // Length must match before timingSafeEqual, which throws on differing sizes;
  // comparing lengths first leaks nothing an attacker can't already measure.
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error(
      '[elyvel] Queued closure signature does not match. The payload was modified '
      + 'after it was queued, or was signed with a different APP_KEY.',
    )
  }
}
