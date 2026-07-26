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

/** Custom pivot model (Laravel's `Pivot` subclass, wired via `.using()`). */
class RoleUserPivot extends Model {
  static override guarded = []
  static override table = 'role_user'
  static override timestamps = false
  declare user_id: number
  declare role_id: number
  declare assigned_by: string

  describe(): string {
    return `assigned by ${this.assigned_by}`
  }
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

  rolesWithExtra() {
    return this.belongsToMany(Role).withPivot('assigned_by')
  }

  rolesWithCustomPivot() {
    return this.belongsToMany(Role).withPivot('assigned_by').using(RoleUserPivot)
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
        t.string('assigned_by').nullable()
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

    test('withPivot() exposes an extra column that is otherwise filtered out', async () => {
      const user = await User.create({ name: 'Ada' })
      const admin = await Role.create({ name: 'admin' })
      await user.roles().attach(admin.id, { assigned_by: 'root' })

      // without withPivot('assigned_by'), the column is stored but NOT exposed
      const plain = await user.roles().get()
      const plainPivot = plain.first()?.getRelation<Record<string, unknown>>('pivot')
      expect(plainPivot?.assigned_by).toBeUndefined()

      // with it, the same column comes through
      const withExtra = await user.rolesWithExtra().get()
      const extraPivot = withExtra.first()?.getRelation<Record<string, unknown>>('pivot')
      expect(extraPivot?.assigned_by).toBe('root')
    })

    test('attach() accepts per-id extra pivot attributes (record form)', async () => {
      const user = await User.create({ name: 'Ada' })
      const admin = await Role.create({ name: 'admin' })
      const editor = await Role.create({ name: 'editor' })
      await user.rolesWithExtra().attach({
        [admin.id]: { assigned_by: 'root' },
        [editor.id]: { assigned_by: 'ada' },
      })

      const roles = await user.rolesWithExtra().get()
      const byName = new Map(roles.all().map(r => [r.name, r.getRelation<Record<string, unknown>>('pivot')]))
      expect(byName.get('admin')?.assigned_by).toBe('root')
      expect(byName.get('editor')?.assigned_by).toBe('ada')
    })

    test('using() returns a real Model instance (with its own methods) as .pivot', async () => {
      const user = await User.create({ name: 'Ada' })
      const admin = await Role.create({ name: 'admin' })
      await user.rolesWithCustomPivot().attach(admin.id, { assigned_by: 'root' })

      const roles = await user.rolesWithCustomPivot().get()
      const pivot = roles.first()?.getRelation<RoleUserPivot>('pivot')
      expect(pivot).toBeInstanceOf(RoleUserPivot)
      expect(pivot?.describe()).toBe('assigned by root')
    })
  })
}
