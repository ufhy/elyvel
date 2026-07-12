import { Model } from '@elysia-ravel/database'

export class User extends Model {
  static override table = 'users'
  static override hidden = ['password'] // never serialized
  // `phone` is encrypted at rest (ciphertext in the DB) and transparently
  // decrypted on read — powered by config('app.key').
  static override casts = { id: 'int', phone: 'encrypted' } as const

  declare id: number
  declare name: string
  declare email: string
  declare password: string
  declare phone: string | null
}

export default User
