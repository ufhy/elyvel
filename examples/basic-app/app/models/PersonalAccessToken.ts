import { Model } from '@elysia-ravel/eloquent'

/** Sanctum-style API tokens. Only the SHA-256 hash of a token is stored. */
export class PersonalAccessToken extends Model {
  static override table = 'personal_access_tokens'
  static override timestamps = false
  static override casts = { id: 'int', user_id: 'int' } as const

  declare id: number
  declare user_id: number
  declare token: string
}

export default PersonalAccessToken
