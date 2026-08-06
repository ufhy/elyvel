import type { HasRolesFields } from '../src/concern'
import { createConnection, Model, SchemaBuilder, setConnection, withConcerns } from '@elyvel/database'
import { HasRoles } from '../src/concern'
import { configurePermissions, forgetPermissionCache } from '../src/registrar'
import { migratePermissionTables } from '../src/schema'

// eslint-disable-next-line ts/no-unsafe-declaration-merging -- the concern only adds methods
export interface User extends HasRolesFields {
  id: number
  name: string
}

// eslint-disable-next-line ts/no-unsafe-declaration-merging
export class User extends Model {
  static override table = 'users'
  static override fillable = ['name']
}
withConcerns(User, HasRoles)

/** A model that is NOT a user — proves the pivot really is polymorphic. */
// eslint-disable-next-line ts/no-unsafe-declaration-merging
export interface Team extends HasRolesFields {
  id: number
  name: string
}

// eslint-disable-next-line ts/no-unsafe-declaration-merging
export class Team extends Model {
  static override table = 'teams'
  static override fillable = ['name']
}
withConcerns(Team, HasRoles)

/** A fresh in-memory database with the permission tables and two subject tables. */
export async function freshDatabase(): Promise<void> {
  const connection = await createConnection({ driver: 'sqlite', database: ':memory:' })
  setConnection(connection)
  configurePermissions(undefined)
  await forgetPermissionCache()

  const schema = new SchemaBuilder(connection)
  await migratePermissionTables(schema)
  await schema.create('users', (table) => {
    table.id()
    table.string('name')
    table.timestamps()
  })
  await schema.create('teams', (table) => {
    table.id()
    table.string('name')
    table.timestamps()
  })
}
