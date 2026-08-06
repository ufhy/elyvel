/**
 * `elyvel permission:*`, discovered via `elyvel package:discover`. Kept behind
 * the `/cli` subpath so a running app never loads command code.
 */
import type { ConsoleCommand } from '@elyvel/core'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { comment, error, info, table as printTable } from '@elyvel/cli'
import { createApp } from '@elyvel/core'
import { DatabaseToken, table } from '@elyvel/database'
import { DEFAULT_GUARD, tableNames } from './config'
import { Permission, Role } from './models'
import { configurePermissions, forgetPermissionCache, permissionCatalogue, permissionConfig } from './registrar'

const MIGRATION = `import type { Migration } from '@elyvel/database'
import { config } from '@elyvel/core'
import { migratePermissionTables, rollbackPermissionTables } from '@elyvel/permission'

/**
 * Roles, permissions, and the pivots joining them to any model. Table names
 * come from config/permission.ts, so changing them there is enough.
 */
export default {
  up: schema => migratePermissionTables(schema, config('permission', undefined)),
  down: schema => rollbackPermissionTables(schema, config('permission', undefined)),
} satisfies Migration
`

function timestamp(): string {
  const now = new Date()
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`
    + `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
}

function permissionMigration(): number {
  const dir = join(process.cwd(), 'database', 'migrations')
  if (!existsSync(dir)) {
    error('No database/migrations directory here — run this inside an elyvel app.')
    return 1
  }
  const target = join(dir, `${timestamp()}_create_permission_tables.ts`)
  writeFileSync(target, MIGRATION)
  info(`Created ${target.replace(`${process.cwd()}/`, '')}`)
  comment('Run `elyvel migrate` to create the tables.')
  return 0
}

/** Boot the app so config, the connection, and the cache are the real ones. */
async function withApp<T>(fn: () => Promise<T>): Promise<T> {
  const app = await createApp({ basePath: process.cwd(), autoloadRoutes: false })
  configurePermissions(app.config.get('permission', undefined))
  app.make(DatabaseToken) // fail loudly here if no connection is bound
  return fn()
}

function guardFrom(flags: Record<string, string | boolean>): string {
  return typeof flags.guard === 'string' ? flags.guard : DEFAULT_GUARD
}

async function createRole(flags: Record<string, string | boolean>, args: string[]): Promise<number> {
  const name = args[0]
  if (!name) {
    error('Usage: elyvel permission:create-role <name> [--guard=web] [--permissions=a,b]')
    return 1
  }
  return withApp(async () => {
    const guard = guardFrom(flags)
    const existing = await Role.query().where('name', name).where('guard', guard).first()
    const role = existing ?? await Role.create({ name, guard })
    if (existing)
      comment(`Role "${name}" (${guard}) already exists — reusing it.`)
    else info(`Created role "${name}" (${guard}).`)

    if (typeof flags.permissions === 'string') {
      const wanted = flags.permissions.split(',').map(p => p.trim()).filter(Boolean)
      for (const permissionName of wanted) {
        const permission = await Permission.query().where('name', permissionName).where('guard', guard).first()
          ?? await Permission.create({ name: permissionName, guard })
        const t = tableNames(permissionConfig())
        const already = await table(t.roleHasPermissions)
          .where('role_id', role.id)
          .where('permission_id', permission.id)
          .first()
        if (!already)
          await table(t.roleHasPermissions).insert({ role_id: role.id, permission_id: permission.id })
      }
      info(`Granted: ${wanted.join(', ')}`)
    }
    await forgetPermissionCache()
    return 0
  })
}

async function createPermission(flags: Record<string, string | boolean>, args: string[]): Promise<number> {
  const name = args[0]
  if (!name) {
    error('Usage: elyvel permission:create-permission <name> [--guard=web]')
    return 1
  }
  return withApp(async () => {
    const guard = guardFrom(flags)
    const existing = await Permission.query().where('name', name).where('guard', guard).first()
    if (existing) {
      comment(`Permission "${name}" (${guard}) already exists.`)
      return 0
    }
    await Permission.create({ name, guard })
    await forgetPermissionCache()
    info(`Created permission "${name}" (${guard}).`)
    return 0
  })
}

async function show(): Promise<number> {
  return withApp(async () => {
    const catalogue = await permissionCatalogue()
    if (catalogue.roles.length === 0 && catalogue.permissions.length === 0) {
      comment('No roles or permissions yet.')
      return 0
    }
    const byId = new Map(catalogue.permissions.map(p => [p.id, p.name]))
    printTable(
      ['Role', 'Guard', 'Permissions'],
      catalogue.roles.map(role => [
        role.name,
        role.guard,
        role.permissionIds.map(id => byId.get(id) ?? `#${id}`).sort().join(', ') || '—',
      ]),
    )
    const granted = new Set(catalogue.roles.flatMap(r => r.permissionIds))
    const orphans = catalogue.permissions.filter(p => !granted.has(p.id))
    if (orphans.length > 0)
      comment(`Not in any role: ${orphans.map(p => p.name).sort().join(', ')}`)
    return 0
  })
}

export const elyvelCommands: ConsoleCommand[] = [
  {
    name: 'permission:migration',
    description: 'Generate the migration that creates the roles/permissions tables',
    run: permissionMigration,
  },
  {
    name: 'permission:create-role',
    description: 'Create a role, optionally granting permissions',
    usage: '<name> [--guard=web] [--permissions=a,b]',
    run: createRole,
  },
  {
    name: 'permission:create-permission',
    description: 'Create a permission',
    usage: '<name> [--guard=web]',
    run: createPermission,
  },
  {
    name: 'permission:show',
    description: 'Show every role with the permissions it grants',
    run: show,
  },
]
