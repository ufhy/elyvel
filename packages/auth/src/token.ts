/**
 * Generate a high-entropy, URL-safe plaintext API token (~256 bits). Shown to
 * the client once; only its {@link hashToken hash} is ever persisted.
 */
export function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Buffer.from(bytes).toString('base64url')
}

/** Deterministic SHA-256 hash used as the token's storage key. */
export function hashToken(raw: string): string {
  return new Bun.CryptoHasher('sha256').update(raw).digest('hex')
}
