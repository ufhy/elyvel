# Encryption

Authenticated symmetric encryption — Laravel's `Crypt`. AES-256-GCM, keyed by
`app.key`, which is the same secret behind signed URLs, the session cookie, and
the `encrypted` model cast.

```ts
import { Crypt } from '@elyvel/core'

const payload = Crypt.encryptString('hunter2')
Crypt.decryptString(payload) // 'hunter2'

// Any JSON-serialisable value, as Laravel's encrypt() serialises:
const token = Crypt.encrypt({ userId: 7, scope: ['read'] })
Crypt.decrypt<{ userId: number }>(token).userId // 7
```

`encrypt`/`decrypt`/`encryptString`/`decryptString` are also exported directly if
you prefer plain functions.

## What "authenticated" buys you

The ciphertext carries a GCM tag, so a modified payload **fails loudly** rather
than decrypting into different plaintext:

```ts
Crypt.decryptString(tampered)
// Error: Cannot decrypt: wrong key, or the payload was modified after it was encrypted.
```

Every call uses a fresh random IV, so encrypting the same value twice produces
different output. That is deliberate — identical ciphertext for identical input
leaks which records match.

## The key

Set `APP_KEY` (the scaffold's `.env` has it, and `bun run key:generate` fills it
in). An empty key is **rejected**, not accepted: hashing the empty string would
produce a key identical in every installation, and an app deployed with
`APP_KEY=` would have encrypted everything under a guessable secret without any
sign that something was wrong.

`Crypt.hasKey()` reports whether one is configured, for code that would rather
degrade than throw.

## Model columns

The `encrypted` cast uses this same implementation and the same payload format,
so a value written by a cast decrypts with `Crypt` and vice versa:

```ts
class User extends Model {
  static casts = { ssn: 'encrypted' }
}
```

## `appearsEncrypted`

A **shape** check, useful while migrating a column that holds a mix of encrypted
and plaintext values. It cannot tell a forged payload from a real one — only
`decrypt` can, and that is what the authentication tag is for.

```ts
Crypt.appearsEncrypted(row.ssn) ? Crypt.decryptString(row.ssn) : row.ssn
```
