export type Awaitable<T> = T | Promise<T>

/** Minimum shape a user must satisfy to be authenticated. */
export interface Authenticatable {
  id: string | number
}

export interface Credentials {
  email: string
  password: string
}

/**
 * Bridges the framework to your user storage — the Elysia-first equivalent of
 * Laravel's `UserProvider`. Implement it over your model in the app layer so
 * the auth package stays storage-agnostic and fully typed.
 */
export interface UserProvider<U extends Authenticatable> {
  retrieveById(id: string | number): Awaitable<U | null>
  retrieveByCredentials(credentials: Credentials): Awaitable<U | null>
  validateCredentials(user: U, credentials: Credentials): Awaitable<boolean>
}

/**
 * Persistence for issued API tokens. Only hashed tokens are ever stored; the
 * plaintext is shown to the client once at creation.
 */
export interface TokenStore {
  store(record: { userId: string | number; hashedToken: string }): Awaitable<void>
  findUserId(hashedToken: string): Awaitable<string | number | null>
  revoke(hashedToken: string): Awaitable<void>
}
