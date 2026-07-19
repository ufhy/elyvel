import type { Authenticatable, Credentials, TokenStore, UserProvider } from './types'
import { RateLimiter } from '@elyvel/core'
import { createGuard } from './guard'
import { generateToken, hashToken } from './token'

export interface AuthConfig<U extends Authenticatable> {
  provider: UserProvider<U>
  tokens: TokenStore
  /** Max failed attempts before a lockout (Laravel Fortify's `ThrottlesLogins`). Default 5. */
  maxAttempts?: number
  /** Lockout window in minutes once `maxAttempts` is hit. Default 1. */
  decayMinutes?: number
}

export interface Attempt<U> {
  user: U
  /** Plaintext token — return this to the client; it is never stored. */
  token: string
}

/** Thrown by `attempt()` when the credential has hit its failed-attempt lockout. */
export class TooManyAttemptsError extends Error {
  constructor(public readonly retryAfter: number) {
    super(`Too many login attempts. Please try again in ${retryAfter} seconds.`)
    this.name = 'TooManyAttemptsError'
  }
}

/**
 * Orchestrates token authentication against a {@link UserProvider} and
 * {@link TokenStore}. Stateless beyond what the token store persists.
 *
 * This is a standalone, bring-your-own-storage token guard — a lighter-weight
 * alternative for apps that want simple API-token auth without a session
 * layer. It's independent of `betterAuthPlugin()` (this package's other,
 * primary auth path, backed by the `better-auth` library with its own
 * session/2FA/social-login handling) — pick one, they don't compose. If
 * you're building a full-stack app with sessions/2FA, use
 * `betterAuthPlugin()`; use `AuthManager` for a minimal token API surface
 * (e.g. a machine-to-machine or mobile-client API) where that's more than
 * you need.
 */
export class AuthManager<U extends Authenticatable> {
  constructor(private readonly config: AuthConfig<U>) {}

  /**
   * Verify credentials and, on success, issue a fresh API token. Throws
   * {@link TooManyAttemptsError} if this email has failed too many times
   * recently — brute-force lockout keyed on the email being attempted (not
   * available: the caller's IP, since `attempt()` only receives credentials;
   * layer `{ middleware: 'throttle:N,1' }` on the login route itself for
   * IP-based throttling too). Backed by `@elyvel/core`'s `RateLimiter` — the
   * same facade HTTP throttling uses, so it's cross-process-safe wherever a
   * shared store (`RedisRateLimiterStore`) is configured.
   */
  async attempt(credentials: Credentials): Promise<Attempt<U> | null> {
    const key = `auth-attempt:${credentials.email.toLowerCase()}`
    const maxAttempts = this.config.maxAttempts ?? 5
    const decaySeconds = (this.config.decayMinutes ?? 1) * 60

    if (await RateLimiter.tooManyAttempts(key, maxAttempts)) {
      throw new TooManyAttemptsError(await RateLimiter.availableIn(key))
    }

    const user = await this.config.provider.retrieveByCredentials(credentials)
    const valid = user ? await this.config.provider.validateCredentials(user, credentials) : false

    if (!user || !valid) {
      await RateLimiter.hit(key, decaySeconds)
      return null
    }

    await RateLimiter.clear(key) // a successful login resets the counter
    const token = generateToken()
    await this.config.tokens.store({ userId: user.id, hashedToken: hashToken(token) })
    return { user, token }
  }

  /** Resolve the user for a plaintext token, or null if invalid/revoked. */
  async user(token: string): Promise<U | null> {
    const userId = await this.config.tokens.findUserId(hashToken(token))
    if (userId === null || userId === undefined)
      return null
    return this.config.provider.retrieveById(userId)
  }

  /** Revoke a token so it can no longer authenticate. */
  async logout(token: string): Promise<void> {
    await this.config.tokens.revoke(hashToken(token))
  }

  /** An Elysia plugin that derives `user`/`authToken` and adds the `auth` macro. */
  guard() {
    return createGuard(this)
  }
}

export function createAuth<U extends Authenticatable>(config: AuthConfig<U>): AuthManager<U> {
  return new AuthManager<U>(config)
}
