import type { Dayjs } from '@elyvel/database'
import { Model } from '@elyvel/database'

/**
 * The Better Auth-managed `users` table as a real Eloquent model — so app
 * code can `belongsTo(AuthUser, 'user_id')` / `hasMany`/etc instead of only
 * poking the table with a bare `user_id` column (as `Post.ts` does today).
 *
 * Covers only the fields Better Auth ALWAYS has, snake_case (see
 * `defineAuth`'s column remap). A plugin's own additional fields on `users`
 * (e.g. `twoFactor()`'s `twoFactorEnabled` — NOT remapped, see `defineAuth`)
 * still work as raw attributes; just `declare` them yourself if you want them
 * typed: `declare twoFactorEnabled: boolean` in a subclass, or add fields
 * directly on this class in your own app if you'd rather not subclass.
 *
 * Read-mostly by design: Better Auth writes `users` itself through its own
 * adapter (sign-up, profile update, ...), not through this class's `save()`.
 * Use it to query/relate (`AuthUser.find(id)`, `post.user()`), not to
 * register or update accounts — do that through the Better Auth API/routes.
 */
export class AuthUser extends Model {
  static override table = 'users'
  static override fillable = ['name', 'email', 'image']
  static override casts = {
    email_verified: 'boolean' as const,
  }

  declare id: string
  declare name: string
  declare email: string
  declare email_verified: boolean
  declare image: string | null
  declare created_at: Dayjs
  declare updated_at: Dayjs

  accounts() {
    return this.hasMany(AuthAccount, 'user_id')
  }

  sessions() {
    return this.hasMany(AuthSession, 'user_id')
  }
}

/**
 * The Better Auth-managed `accounts` table (one row per linked sign-in
 * method — email/password, each OAuth provider, ...) as a real Eloquent
 * model. A `users` row can own several `accounts` rows; `accounts` is never
 * the identity itself, always `belongsTo` a `AuthUser`.
 *
 * Sensitive columns (`access_token`/`refresh_token`/`id_token`/`password`)
 * are hidden by default — same reasoning as hiding `password` on a normal
 * Laravel `User` model.
 */
export class AuthAccount extends Model {
  static override table = 'accounts'
  static override fillable = ['account_id', 'provider_id', 'user_id', 'scope']
  static override hidden = ['access_token', 'refresh_token', 'id_token', 'password']
  static override casts = {
    access_token_expires_at: 'datetime' as const,
    refresh_token_expires_at: 'datetime' as const,
  }

  declare id: string
  declare account_id: string
  declare provider_id: string
  declare user_id: string
  declare access_token: string | null
  declare refresh_token: string | null
  declare id_token: string | null
  declare access_token_expires_at: Dayjs | null
  declare refresh_token_expires_at: Dayjs | null
  declare scope: string | null
  declare password: string | null
  declare created_at: Dayjs
  declare updated_at: Dayjs

  user() {
    return this.belongsTo(AuthUser, 'user_id')
  }
}

/**
 * The Better Auth-managed `sessions` table — one row per active login
 * session (the value behind the session cookie/token), `belongsTo` a `AuthUser`.
 * Useful for "list my active sessions" / "revoke this session" UI, though
 * Better Auth's own `/list-sessions`/`/revoke-session` API already covers
 * that without touching this class directly.
 *
 * The session `token` itself is hidden by default — same reasoning as
 * `AuthAccount`'s hidden provider tokens.
 */
export class AuthSession extends Model {
  static override table = 'sessions'
  static override hidden = ['token']

  declare id: string
  declare user_id: string
  declare token: string
  declare expires_at: Dayjs
  declare ip_address: string | null
  declare user_agent: string | null
  declare created_at: Dayjs
  declare updated_at: Dayjs

  user() {
    return this.belongsTo(AuthUser, 'user_id')
  }
}

/**
 * The Better Auth-managed `verifications` table — short-lived tokens for
 * email verification / password reset. Not tied to a `users` row by a FK
 * (Better Auth keys these by `identifier`, e.g. an email address, not a user
 * id) — included for completeness/introspection, not because app code
 * typically queries it directly.
 */
export class AuthVerification extends Model {
  static override table = 'verifications'

  declare id: string
  declare identifier: string
  declare value: string
  declare expires_at: Dayjs
  declare created_at: Dayjs
  declare updated_at: Dayjs
}
