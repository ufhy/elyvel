import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * Symmetric encryption for the `encrypted` cast (AES-256-GCM). The key is set
 * at boot from `config('app.key')`; it's hashed to 32 bytes so any string works.
 */
let key: Buffer | null = null

export function setEncryptionKey(secret: string): void {
  key = createHash('sha256').update(secret).digest()
}

function requireKey(): Buffer {
  if (!key) {
    throw new Error('[eloquent] Encryption key not set. Configure `app.key` to use encrypted casts.')
  }
  return key
}

/** Encrypt → `base64(iv):base64(tag):base64(ciphertext)`. */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', requireKey(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

export function decrypt(payload: string): string {
  const [iv, tag, enc] = payload.split(':')
  const decipher = createDecipheriv('aes-256-gcm', requireKey(), Buffer.from(iv as string, 'base64'))
  decipher.setAuthTag(Buffer.from(tag as string, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(enc as string, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}
