import type { HasRolesFields } from '../src/concern'
import type { PermissionConfig } from '../src/config'
import { createConnection, Model, SchemaBuilder, setConnection, withConcerns } from '@elyvel/database'
import { afterAll, describe, expect, test } from 'bun:test'
import { HasRoles } from '../src/concern'
import { Permission, Role } from '../src/models'
import { configurePermissions, forgetPermissionCache } from '../src/registrar'
import { migratePermissionTables } from '../src/schema'

/**
 * `config/permission.ts` advertises renameable tables, so every path has to
 * honour them — and two didn't. The models hard-coded their table at class
 * definition (config isn't loaded yet then), so `Role.query()` hit a `roles`
 * table the migration had never created; and the CLI resolved the pivot with
 * no config at all. Both are silent: the migration succeeds, then writes land
 * in — or fail against — the wrong table.
 */
const CUSTOM: PermissionConfig = {
  tables: {
    roles: 'acl_roles',
    permissions: 'acl_permissions',
    modelHasRoles: 'acl_model_roles',
    modelHasPermissions: 'acl_model_permissions',
    roleHasPermissions: 'acl_role_permissions',
  },
}

// eslint-disable-next-line ts/no-unsafe-declaration-merging
interface Member extends HasRolesFields {
  id: number
  name: string
}

// eslint-disable-next-line ts/no-unsafe-declaration-merging
class Member extends Model {
  static override table = 'members'
  static override fillable = ['name']
}
withConcerns(Member, HasRoles)

afterAll(() => {
  // Leave the shared models pointing at the defaults for other test files.
  configurePermissions(undefined)
})

describe('renamed tables', () => {
  test('models, pivots, and checks all use the configured names', async () => {
    const connection = await createConnection({ driver: 'sqlite', database: ':memory:' })
    setConnection(connection)
    configurePermissions(CUSTOM)
    await forgetPermissionCache()

    const schema = new SchemaBuilder(connection)
    await migratePermissionTables(schema, CUSTOM)
    await schema.create('members', (t) => {
      t.id()
      t.string('name')
      t.timestamps()
    })

    // Only the custom tables exist — a default-named write would throw here.
    const permission = await Permission.create({ name: 'edit posts', guard: 'web' })
    const role = await Role.create({ name: 'editor', guard: 'web' })
    await role.permissions().attach([permission.id])
    await forgetPermissionCache()

    const member = await Member.create({ name: 'Ada' })
    await member.assignRole('editor')

    expect(await member.getRoleNames()).toEqual(['editor'])
    expect(await member.hasPermissionTo('edit posts')).toBe(true)

    // And the rows really are in the renamed tables.
    const { table } = await import('@elyvel/database')
    expect((await table('acl_model_roles').get()).length).toBe(1)
    expect((await table('acl_role_permissions').get()).length).toBe(1)
  })
})
