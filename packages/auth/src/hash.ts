/**
 * Password hashing over Bun's native `Bun.password` (argon2id by default).
 * No external dependency, constant-time verification.
 */
export const Hash = {
  /** Hash a plaintext value. */
  make(value: string): Promise<string> {
    return Bun.password.hash(value)
  },

  /** Verify a plaintext value against a stored hash. */
  verify(value: string, hashed: string): Promise<boolean> {
    return Bun.password.verify(value, hashed)
  },
}
