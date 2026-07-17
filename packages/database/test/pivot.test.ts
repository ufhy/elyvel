import { beforeEach, describe, expect, test } from 'bun:test'
import { setConnection } from '../src/connection'
import { Model } from '../src/model'
import { SchemaBuilder } from '../src/schema'
import { dialects } from './dialects'

class Role extends Model {
  static override guarded = []
  static override table = 'roles'
  static override timestamps = false
  declare id: number
  declare name: string
}
class User extends Model {
  static override guarded = []
  static override table = 'users'
  static override timestamps = false
  declare id: number
  declare name: string
  roles() {
    return this.belongsToMany(Role).withTimestamps()
  }
}

for (const d of dialects) {
  describe(`pivot extras (${d.name})`, () => {
    beforeEach(async () => {
      const conn = await d.connect()
      setConnection(conn)
      const schema = new SchemaBuilder(conn)
      await schema.create('users', (t) => {
        t.id()
        t.string('name')
      })
      await schema.create('roles', (t) => {
        t.id()
        t.string('name')
      })
      await schema.create('role_user', (t) => {
        t.integer('user_id')
        t.integer('role_id')
        t.timestamp('created_at').nullable()
        t.timestamp('updated_at').nullable()
      })
    })

    test('withTimestamps + pivot attached to results', async () => {
      const user = await User.create({ name: 'Ada' })
      const admin = await Role.create({ name: 'admin' })
      await user.roles().attach(admin.id)

      const roles = await user.roles().get()
      const pivot = roles.first()?.getRelation<Record<string, unknown>>('pivot')
      expect(Number(pivot?.user_id)).toBe(user.id)
      expect(Number(pivot?.role_id)).toBe(admin.id)
      expect(typeof pivot?.created_at).toBe('string') // withTimestamps set it

      // serialized JSON carries the pivot
      const json = roles.first()?.toJSON() as { pivot?: Record<string, unknown> }
      expect(json.pivot?.role_id).toBeDefined()
    })

    test('pivot appears via eager loading too', async () => {
      const user = await User.create({ name: 'Ada' })
      const admin = await Role.create({ name: 'admin' })
      await user.roles().attach(admin.id)

      const users = await User.query().with('roles').get()
      const roles = users.first()?.getRelation('roles') as any
      const pivot = roles.first()?.getRelation('pivot') as Record<string, unknown>
      expect(Number(pivot?.role_id)).toBe(admin.id)
    })
  })
}
