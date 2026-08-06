/**
 * The five tables, created from one function so an app's migration stays a
 * two-liner and a table-name change in `config/permission.ts` is honoured
 * without editing the migration.
 *
 * The two `model_has_*` tables are polymorphic pivots (`model_type` +
 * `model_id`): a role can be attached to ANY model, not just a user — an API
 * client, a team, an organisation.
 */
import type { SchemaBuilder } from '@elyvel/database'
import type { PermissionConfig } from './config'
import { tableNames } from './config'

export async function migratePermissionTables(
  schema: SchemaBuilder,
  config?: PermissionConfig,
): Promise<void> {
  const t = tableNames(config)

  await schema.create(t.permissions, (table) => {
    table.id()
    table.string('name')
    table.string('guard')
    table.timestamps()
    // A permission name is unique *per guard*, not globally — the same
    // "edit posts" can exist for the web guard and the api guard.
    table.unique(['name', 'guard'])
  })

  await schema.create(t.roles, (table) => {
    table.id()
    table.string('name')
    table.string('guard')
    table.timestamps()
    table.unique(['name', 'guard'])
  })

  await schema.create(t.roleHasPermissions, (table) => {
    table.foreignId('permission_id').constrained(t.permissions).cascadeOnDelete()
    table.foreignId('role_id').constrained(t.roles).cascadeOnDelete()
    table.unique(['permission_id', 'role_id'])
  })

  await schema.create(t.modelHasRoles, (table) => {
    table.foreignId('role_id').constrained(t.roles).cascadeOnDelete()
    table.string('model_type')
    table.string('model_id')
    table.index(['model_id', 'model_type'], `${t.modelHasRoles}_model_index`)
    table.unique(['role_id', 'model_id', 'model_type'])
  })

  await schema.create(t.modelHasPermissions, (table) => {
    table.foreignId('permission_id').constrained(t.permissions).cascadeOnDelete()
    table.string('model_type')
    table.string('model_id')
    table.index(['model_id', 'model_type'], `${t.modelHasPermissions}_model_index`)
    table.unique(['permission_id', 'model_id', 'model_type'])
  })
}

/** Drop them again, children first. */
export async function rollbackPermissionTables(
  schema: SchemaBuilder,
  config?: PermissionConfig,
): Promise<void> {
  const t = tableNames(config)
  for (const table of [t.modelHasPermissions, t.modelHasRoles, t.roleHasPermissions, t.roles, t.permissions])
    await schema.dropIfExists(table)
}
