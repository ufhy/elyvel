import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * Optional AES-256-GCM encryption for job payloads (Laravel's
 * `ShouldBeEncrypted`). Wire a key with {@link configureJobEncryption}; without
 * one, `encrypt` jobs throw rather than silently storing plaintext.
 */
const PREFIX = 'ENC:'
let key: Buffer | null = null

/** Set the encryption key (any string; hashed to 32 bytes). */
export function configureJobEncryption(secret: string): void {
  key = createHash('sha256').update(secret).digest()
}

export function isEncrypted(body: string): boolean {
  return body.startsWith(PREFIX)
}

export function encryptString(plaintext: string): string {
  if (!key) throw new Error('[elysia-ravel] Encrypted jobs need configureJobEncryption(secret).')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decryptString(body: string): string {
  if (!key) throw new Error('[elysia-ravel] Encrypted jobs need configureJobEncryption(secret).')
  const raw = Buffer.from(body.slice(PREFIX.length), 'base64')
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const enc = raw.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}
