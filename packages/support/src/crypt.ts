import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * Authenticated symmetric encryption — Laravel's `Crypt` facade / `Encrypter`.
 *
 * This existed already, but only inside `@elyvel/database`, reachable by the
 * `encrypted` cast and nothing else. An app that needed to encrypt anything that
 * isn't a model column — a token in a cache entry, a payload in a queued job, a
 * value in a cookie it manages itself — had to either import another package's
 * internals or hand-roll AES, which is where nonce reuse and missing
 * authentication tags come from.
 *
 * AES-256-GCM: the ciphertext carries an authentication tag, so tampering fails
 * loudly at `decrypt()` instead of silently returning different plaintext.
 */

let key: Buffer | null = null

/**
 * Set the process-wide encryption key. Called at boot from `config('app.key')`;
 * any string works — it is SHA-256'd to the 32 bytes AES-256 requires.
 */
export function setEncryptionKey(secret: string): void {
  // An empty secret used to be accepted, producing a valid-looking key derived
  // from the empty string — identical in every installation, and therefore
  // guessable. An app that ships `APP_KEY=` (unset in .env, or wiped by a
  // deployment) would have encrypted everything under it and never known.
  if (secret.trim() === '') {
    throw new Error(
      '[elyvel] The encryption key is empty. Run `bun run key:generate`, or set APP_KEY.',
    )
  }
  key = createHash('sha256').update(secret).digest()
}

/** Forget the configured key. For tests; an application sets one and keeps it. */
export function clearEncryptionKey(): void {
  key = null
}

/** Is a key configured? Lets a caller degrade gracefully instead of throwing. */
export function hasEncryptionKey(): boolean {
  return key !== null
}

function requireKey(): Buffer {
  if (!key) {
    throw new Error(
      '[elyvel] Encryption key not set. Configure `app.key` (e.g. via APP_KEY) before encrypting.',
    )
  }
  return key
}

/** `base64(iv):base64(tag):base64(ciphertext)` — three parts, in that order. */
const PAYLOAD_PARTS = 3

/**
 * Encrypt a string. Format is `base64(iv):base64(tag):base64(ciphertext)`,
 * unchanged from what the `encrypted` cast has always written, so existing
 * column values keep decrypting.
 */
export function encryptString(plaintext: string): string {
  // A fresh 12-byte IV per call. Reusing one under the same key is the mistake
  // that breaks GCM completely — it leaks the XOR of two plaintexts.
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', requireKey(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

/**
 * Decrypt a string produced by {@link encryptString}. Throws when the payload is
 * malformed, truncated, or has been tampered with — a modified ciphertext fails
 * the GCM tag check rather than returning plausible garbage.
 */
export function decryptString(payload: string): string {
  const parts = payload.split(':')
  if (parts.length !== PAYLOAD_PARTS) {
    throw new Error('[elyvel] Cannot decrypt: the payload is not in the expected format.')
  }
  const [iv, tag, enc] = parts as [string, string, string]
  try {
    const decipher = createDecipheriv('aes-256-gcm', requireKey(), Buffer.from(iv, 'base64'))
    decipher.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(enc, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  }
  catch (error) {
    // `final()` throws on a failed tag check. Say what happened, because the
    // native message ("Unsupported state or unable to authenticate data") sends
    // people looking for a cipher problem rather than a wrong key or edited data.
    if (!hasEncryptionKey())
      throw error
    throw new Error(
      '[elyvel] Cannot decrypt: wrong key, or the payload was modified after it was encrypted.',
      { cause: error },
    )
  }
}

/** Encrypt any JSON-serialisable value. Laravel's `encrypt()` serialises too. */
export function encrypt(value: unknown): string {
  return encryptString(JSON.stringify(value))
}

/** Decrypt a value written by {@link encrypt}. */
export function decrypt<T = unknown>(payload: string): T {
  return JSON.parse(decryptString(payload)) as T
}

/**
 * Does this look like something {@link encryptString} produced? A shape check,
 * NOT a validity check — it cannot tell a forged payload from a real one, and is
 * only useful for deciding whether a stored value was ever encrypted (e.g. while
 * migrating a column).
 */
export function appearsEncrypted(value: unknown): boolean {
  if (typeof value !== 'string')
    return false
  const parts = value.split(':')
  if (parts.length !== PAYLOAD_PARTS)
    return false
  return parts.every(part => part.length > 0 && /^[A-Z0-9+/]+={0,2}$/i.test(part))
}

/**
 * The `Crypt` namespace, mirroring Laravel's facade so the same names are where
 * a Laravel developer looks for them.
 */
export const Crypt = {
  encrypt,
  decrypt,
  encryptString,
  decryptString,
  appearsEncrypted,
  hasKey: hasEncryptionKey,
  setKey: setEncryptionKey,
  clearKey: clearEncryptionKey,
}
