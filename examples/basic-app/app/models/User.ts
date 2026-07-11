import { Model } from '@elysia-ravel/eloquent'

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
