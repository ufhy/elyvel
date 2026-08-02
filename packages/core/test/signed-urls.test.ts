import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  clearRouteNames,
  hasValidSignature,
  named,
  setUrlSigningKey,
  signedUrl,
} from '../src/url'

beforeEach(() => {
  clearRouteNames()
  named('unsubscribe', '/unsubscribe/:user')
  named('download', '/files/:id')
  setUrlSigningKey('test-signing-key')
})
afterEach(() => setUrlSigningKey(undefined))

/**
 * A link that authenticates the ACTION rather than the person: an unsubscribe
 * link in an email, a one-off download, an invitation. The usual alternative is
 * a random token in a table — which needs the table, a lookup on every request,
 * and a job to clean it up, to achieve the same thing.
 */
describe('signedUrl', () => {
  test('appends a signature that verifies', () => {
    const url = signedUrl('unsubscribe', { user: 42 })
    expect(url).toStartWith('/unsubscribe/42?signature=')
    expect(hasValidSignature(url)).toBe(true)
  })

  test('a tampered parameter invalidates it — the whole point', () => {
    const url = signedUrl('unsubscribe', { user: 42 })
    expect(hasValidSignature(url.replace('/42?', '/43?'))).toBe(false)
  })

  test('a tampered query value invalidates it', () => {
    const url = signedUrl('download', { id: 7, quality: 'low' })
    expect(hasValidSignature(url.replace('quality=low', 'quality=high'))).toBe(false)
  })

  test('a URL with no signature is not valid', () => {
    expect(hasValidSignature('/unsubscribe/42')).toBe(false)
  })

  test('a signature from a different key is not valid', () => {
    const url = signedUrl('unsubscribe', { user: 42 })
    setUrlSigningKey('some-other-key')
    expect(hasValidSignature(url)).toBe(false)
  })

  /**
   * Mail clients and proxies reorder query strings. Signing the sorted form —
   * as Laravel ksorts — keeps a link that survives the trip.
   */
  test('reordering the query string does not invalidate it', () => {
    const url = signedUrl('download', { id: 7, b: '2', a: '1' })
    const parsed = new URL(url, 'http://x')
    const signature = parsed.searchParams.get('signature')!
    const reordered = `/files/7?b=2&signature=${encodeURIComponent(signature)}&a=1`
    expect(hasValidSignature(reordered)).toBe(true)
  })

  test('an absolute URL verifies the same as a path', () => {
    const url = signedUrl('unsubscribe', { user: 42 })
    expect(hasValidSignature(`https://example.test${url}`)).toBe(true)
  })

  describe('expiry', () => {
    test('a link within its window is valid', () => {
      expect(hasValidSignature(signedUrl('unsubscribe', { user: 1 }, { expiresInSeconds: 60 }))).toBe(true)
    })

    test('an expired link is not', () => {
      const url = signedUrl('unsubscribe', { user: 1 }, { expiresAt: new Date(Date.now() - 1000) })
      expect(hasValidSignature(url)).toBe(false)
    })

    /** Moving `expires` forward must break the signature, or expiry means nothing. */
    test('extending the expiry by hand invalidates the signature', () => {
      const url = signedUrl('unsubscribe', { user: 1 }, { expiresInSeconds: 1 })
      const future = Math.floor(Date.now() / 1000) + 99999
      expect(hasValidSignature(url.replace(/expires=\d+/, `expires=${future}`))).toBe(false)
    })

    test('a non-numeric expires is rejected rather than treated as never', () => {
      const url = signedUrl('unsubscribe', { user: 1 }, { expiresInSeconds: 60 })
      expect(hasValidSignature(url.replace(/expires=\d+/, 'expires=forever'))).toBe(false)
    })
  })

  test('`signature` and `expires` are reserved parameter names', () => {
    expect(() => signedUrl('unsubscribe', { user: 1, signature: 'x' })).toThrow(/reserved/)
    expect(() => signedUrl('unsubscribe', { user: 1, expires: 1 })).toThrow(/reserved/)
  })

  /**
   * Verification runs on public endpoints with attacker-controlled input, so a
   * missing key must not turn every request into a 500.
   */
  test('with no signing key configured, signing throws but verifying returns false', () => {
    setUrlSigningKey(undefined)
    expect(() => signedUrl('unsubscribe', { user: 1 })).toThrow(/Signed URLs need a key/)
    expect(hasValidSignature('/unsubscribe/1?signature=deadbeef')).toBe(false)
  })
})
