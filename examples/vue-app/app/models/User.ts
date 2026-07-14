import { Model } from '@elysia-ravel/database'

/** User model — an Eloquent-style Active Record over the `users` table. */
export class User extends Model {
  static override table = 'users'
  static override hidden = ['password'] // never serialized
  static override casts = { id: 'int' } as const

  declare id: number
  declare name: string
  declare email: string
  declare password: string
}

export default User
