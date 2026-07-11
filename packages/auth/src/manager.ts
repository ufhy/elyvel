import { createGuard } from './guard'
import { generateToken, hashToken } from './token'
import type { Authenticatable, Credentials, TokenStore, UserProvider } from './types'

export interface AuthConfig<U extends Authenticatable> {
  provider: UserProvider<U>
  tokens: TokenStore
}

export interface Attempt<U> {
  user: U
  /** Plaintext token — return this to the client; it is never stored. */
  token: string
}

/**
 * Orchestrates token authentication against a {@link UserProvider} and
 * {@link TokenStore}. Stateless beyond what the token store persists.
 */
export class AuthManager<U extends Authenticatable> {
  constructor(private readonly config: AuthConfig<U>) {}

  /** Verify credentials and, on success, issue a fresh API token. */
  async attempt(credentials: Credentials): Promise<Attempt<U> | null> {
    const user = await this.config.provider.retrieveByCredentials(credentials)
    if (!user) return null

    const valid = await this.config.provider.validateCredentials(user, credentials)
    if (!valid) return null

    const token = generateToken()
    await this.config.tokens.store({ userId: user.id, hashedToken: hashToken(token) })
    return { user, token }
  }

  /** Resolve the user for a plaintext token, or null if invalid/revoked. */
  async user(token: string): Promise<U | null> {
    const userId = await this.config.tokens.findUserId(hashToken(token))
    if (userId === null || userId === undefined) return null
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
