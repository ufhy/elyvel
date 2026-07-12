import { type EloquentBuilder, Model } from '@elysia-ravel/database'

/** Sanctum-style API tokens. Only the SHA-256 hash of a token is stored. */
export class PersonalAccessToken extends Model {
  static override table = 'personal_access_tokens'
  static override timestamps = false
  static override casts = { id: 'int', user_id: 'int' } as const

  declare id: number
  declare user_id: number
  declare token: string
  declare expires_at: string | null

  /** Expired tokens are pruned by `ravel model:prune`. */
  static override prunable(): EloquentBuilder<Model> | null {
    return this.query()
      .whereNotNull('expires_at')
      .where('expires_at', '<', new Date().toISOString())
  }
}

export default PersonalAccessToken
