import { beforeEach, describe, expect, test } from 'bun:test'
import { createConnection, setConnection } from '../src/connection'
import { Model } from '../src/model'
import { SchemaBuilder } from '../src/schema'

class Role extends Model {
  static override table = 'roles'
  static override timestamps = false
  declare id: number
  declare name: string
}
class User extends Model {
  static override table = 'users'
  static override timestamps = false
  declare id: number
  declare name: string
  roles() {
    return this.belongsToMany(Role) // pivot: role_user (user_id, role_id)
  }
}

const dialects = [
  { name: 'sqlite', connect: () => createConnection({ driver: 'sqlite', database: ':memory:' }) },
  { name: 'pglite', connect: () => createConnection({ driver: 'pglite' }) },
] as const

for (const d of dialects) {
  describe(`belongsToMany (${d.name})`, () => {
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
      })
    })

    test('attach / get / sync / detach', async () => {
      const user = await User.create({ name: 'Ada' })
      const admin = await Role.create({ name: 'admin' })
      const editor = await Role.create({ name: 'editor' })

      await user.roles().attach([admin.id, editor.id])
      expect((await user.roles().get()).count()).toBe(2)

      await user.roles().sync([admin.id])
      const after = await user.roles().get()
      expect(after.count()).toBe(1)
      expect(after.first()?.name).toBe('admin')

      await user.roles().detach()
      expect((await user.roles().get()).count()).toBe(0)
    })

    test('toggle / syncWithoutDetaching', async () => {
      const user = await User.create({ name: 'Ada' })
      const a = await Role.create({ name: 'a' })
      const b = await Role.create({ name: 'b' })
      await user.roles().attach([a.id])

      await user.roles().toggle([a.id, b.id]) // a present → detached, b absent → attached
      expect(
        (await user.roles().get())
          .all()
          .map(r => r.id)
          .sort(),
      ).toEqual([b.id])

      await user.roles().syncWithoutDetaching([a.id, b.id]) // re-add a, keep b
      expect((await user.roles().get()).count()).toBe(2)
    })

    test('eager loading with() populates the pivot relation', async () => {
      const ada = await User.create({ name: 'Ada' })
      const alan = await User.create({ name: 'Alan' })
      const admin = await Role.create({ name: 'admin' })
      const editor = await Role.create({ name: 'editor' })
      await ada.roles().attach([admin.id, editor.id])
      await alan.roles().attach([admin.id])

      const users = await User.query().with('roles').orderBy('id').get()
      expect(users.get(0)?.getRelation<{ count(): number }>('roles').count()).toBe(2)
      expect(users.get(1)?.getRelation<{ count(): number }>('roles').count()).toBe(1)
    })
  })
}
