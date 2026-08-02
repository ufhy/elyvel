import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  appearsEncrypted,
  clearEncryptionKey,
  decrypt,
  decryptString,
  encrypt,
  encryptString,
  hasEncryptionKey,
  setEncryptionKey,
} from '../src/crypt'

beforeEach(() => setEncryptionKey('a-test-application-key'))
afterEach(() => {
  // The key is process-wide; leaving the wrong one set would make another file
  // fail for a reason that has nothing to do with it.
  setEncryptionKey('a-test-application-key')
})

/**
 * This existed only inside `@elyvel/database`, reachable by the `encrypted` cast
 * and nothing else — so encrypting anything that wasn't a model column meant
 * importing another package's internals or hand-rolling AES, which is where
 * nonce reuse and missing authentication tags come from.
 */
describe('Crypt', () => {
  test('round-trips a string', () => {
    expect(decryptString(encryptString('hunter2'))).toBe('hunter2')
  })

  test('round-trips any JSON value, like Laravel\'s serialising encrypt()', () => {
    const value = { id: 7, tags: ['a', 'b'], nested: { ok: true }, nothing: null }
    expect(decrypt<typeof value>(encrypt(value))).toEqual(value)
    expect(decrypt<string>(encrypt('plain'))).toBe('plain')
    expect(decrypt<number>(encrypt(42))).toBe(42)
  })

  /**
   * A fresh IV per call. Reusing one under the same key breaks GCM outright — it
   * leaks the XOR of the two plaintexts — so identical inputs must not produce
   * identical ciphertext.
   */
  test('the same plaintext encrypts differently every time', () => {
    const a = encryptString('same')
    const b = encryptString('same')
    expect(a).not.toBe(b)
    expect(decryptString(a)).toBe('same')
    expect(decryptString(b)).toBe('same')
  })

  test('an empty string survives the round trip', () => {
    expect(decryptString(encryptString(''))).toBe('')
  })

  test('unicode survives the round trip', () => {
    expect(decryptString(encryptString('halo dunia 🌏 — ör'))).toBe('halo dunia 🌏 — ör')
  })

  /** The authentication tag is the difference between GCM and plain AES-CTR. */
  test('a tampered ciphertext fails loudly instead of decrypting to something else', () => {
    const payload = encryptString('transfer 100')
    const [iv, tag, data] = payload.split(':')
    const flipped = Buffer.from(data!, 'base64')
    flipped[0] = (flipped[0] ?? 0) ^ 0x01
    expect(() => decryptString(`${iv}:${tag}:${flipped.toString('base64')}`))
      .toThrow(/wrong key, or the payload was modified/)
  })

  test('a payload from a different key does not decrypt', () => {
    const payload = encryptString('secret')
    setEncryptionKey('a-completely-different-key')
    expect(() => decryptString(payload)).toThrow(/wrong key, or the payload was modified/)
  })

  test('a malformed payload says so rather than throwing a cipher error', () => {
    expect(() => decryptString('not-a-payload')).toThrow(/not in the expected format/)
    expect(() => decryptString('a:b')).toThrow(/not in the expected format/)
  })

  test('encrypting with no key configured explains what to set', () => {
    clearEncryptionKey()
    expect(hasEncryptionKey()).toBe(false)
    expect(() => encryptString('x')).toThrow(/Encryption key not set/)
  })

  /**
   * An empty secret used to be accepted and hashed, yielding a key that is the
   * same in every installation on earth. An app deploying with `APP_KEY=` would
   * have encrypted its data under a guessable key and had no way to notice.
   */
  test('an empty or whitespace key is refused', () => {
    expect(() => setEncryptionKey('')).toThrow(/encryption key is empty/)
    expect(() => setEncryptionKey('   ')).toThrow(/encryption key is empty/)
  })

  describe('appearsEncrypted', () => {
    test('recognises the shape of a real payload', () => {
      expect(appearsEncrypted(encryptString('x'))).toBe(true)
    })

    test('rejects anything else, including non-strings', () => {
      expect(appearsEncrypted('plain text')).toBe(false)
      expect(appearsEncrypted('a:b')).toBe(false)
      expect(appearsEncrypted('not base64!:x:y')).toBe(false)
      expect(appearsEncrypted(42)).toBe(false)
      expect(appearsEncrypted(null)).toBe(false)
    })
  })
})
