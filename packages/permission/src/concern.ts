/**
 * `HasRoles` — the concern (our trait equivalent) that turns any model into
 * something you can assign roles and permissions to. Apply it with
 * `withConcerns`:
 *
 *   export class User extends Model {}
 *   withConcerns(User, HasRoles)
 *
 * Every method here touches the database, so every method is `async` — the one
 * unavoidable difference from Laravel, where the same calls hide their queries
 * behind lazy relations. Inside a request you rarely call them: the middleware
 * loads the current user's names once and `can()` answers from memory.
 *
 * Guard semantics follow spatie/laravel-permission exactly: a check with NO
 * guard matches across every guard, and passing one narrows it
 * (`hasRole('admin', 'api')`). The guard only defaults to `web` when *writing*
 * — a role has to be created under some guard.
 *
 * Names may also be pipe-separated the way the middleware passes them:
 * `hasRole('admin|editor')` means either.
 */
import type { Concern, Model } from '@elyvel/database'
import type { Subject } from './subject'
import { table } from '@elyvel/database'
import { DEFAULT_GUARD, tableNames } from './config'
import { Permission, Role } from './models'
import { forgetPermissionCache, permissionCatalogue, permissionConfig } from './registrar'
import { subjectOf } from './subject'

/** Fields/methods `HasRoles` adds — merge onto your model for typed access. */
export interface HasRolesFields {
  roles(): Promise<Role[]>
  permissions(): Promise<Permission[]>
  assignRole(...roles: Array<string | Role>): Promise<void>
  removeRole(...roles: Array<string | Role>): Promise<void>
  syncRoles(...roles: Array<string | Role>): Promise<void>
  hasRole(roles: string | string[], guard?: string): Promise<boolean>
  hasAnyRole(...roles: Array<string | string[]>): Promise<boolean>
  hasAllRoles(roles: string | string[], guard?: string): Promise<boolean>
  givePermissionTo(...permissions: Array<string | Permission>): Promise<void>
  revokePermissionTo(...permissions: Array<string | Permission>): Promise<void>
  syncPermissions(...permissions: Array<string | Permission>): Promise<void>
  hasPermissionTo(permission: string | string[], guard?: string): Promise<boolean>
  hasAllPermissions(permissions: string | string[], guard?: string): Promise<boolean>
  hasDirectPermission(permission: string, guard?: string): Promise<boolean>
  getRoleNames(): Promise<string[]>
  getAllPermissions(): Promise<string[]>
}

/** The guard to WRITE under when none is named. Reads don't default — see below. */
function writeGuard(guard?: string): string {
  return guard ?? permissionConfig()?.defaultGuard ?? DEFAULT_GUARD
}

/**
 * Does this record count for the requested guard? An unspecified guard matches
 * every guard, as in Laravel — narrowing is opt-in, so a role created under
 * `api` still answers `hasRole('admin')`.
 */
function guardMatches(recordGuard: string, wanted?: string): boolean {
  return wanted === undefined || recordGuard === wanted
}

function flatten<T>(values: Array<T | T[]>): T[] {
  return values.flat() as T[]
}

/** `'admin|editor'` → `['admin', 'editor']`; anything else passes through. */
function namesOf(value: string | string[]): string[] {
  if (Array.isArray(value))
    return value
  return value.includes('|') ? value.split('|').map(v => v.trim()).filter(Boolean) : [value]
}

/**
 * Resolve names to ids, refusing unknown ones. A typo in `assignRole('adman')`
 * must fail loudly — silently assigning nothing is how an authorization bug
 * ships: the code reads as if the user were an admin and the tests pass.
 */
async function resolveRoleIds(roles: Array<string | Role>, guard: string): Promise<number[]> {
  const catalogue = await permissionCatalogue()
  const ids: number[] = []
  const missing: string[] = []
  for (const role of roles) {
    if (typeof role !== 'string') {
      ids.push(Number(role.id))
      continue
    }
    const found = catalogue.roles.find(r => r.name === role && r.guard === guard)
    if (found)
      ids.push(found.id)
    else missing.push(role)
  }
  if (missing.length > 0) {
    throw new Error(
      `[permission] No role named ${missing.map(m => `"${m}"`).join(', ')} for guard "${guard}". `
      + `Create it first: await Role.create({ name: '${missing[0]}', guard: '${guard}' })`,
    )
  }
  return ids
}

async function resolvePermissionIds(permissions: Array<string | Permission>, guard: string): Promise<number[]> {
  const catalogue = await permissionCatalogue()
  const ids: number[] = []
  const missing: string[] = []
  for (const permission of permissions) {
    if (typeof permission !== 'string') {
      ids.push(Number(permission.id))
      continue
    }
    const found = catalogue.permissions.find(p => p.name === permission && p.guard === guard)
    if (found)
      ids.push(found.id)
    else missing.push(permission)
  }
  if (missing.length > 0) {
    throw new Error(
      `[permission] No permission named ${missing.map(m => `"${m}"`).join(', ')} for guard "${guard}". `
      + `Create it first: await Permission.create({ name: '${missing[0]}', guard: '${guard}' })`,
    )
  }
  return ids
}

/** Role ids currently attached to this subject. */
async function attachedRoleIds(subject: Subject): Promise<number[]> {
  const t = tableNames(permissionConfig())
  const rows = await table(t.modelHasRoles)
    .where('model_type', subject.type)
    .where('model_id', subject.id)
    .select('role_id')
    .get()
  return rows.map(r => Number(r.role_id))
}

/** Permission ids attached directly to this subject (not via a role). */
async function attachedPermissionIds(subject: Subject): Promise<number[]> {
  const t = tableNames(permissionConfig())
  const rows = await table(t.modelHasPermissions)
    .where('model_type', subject.type)
    .where('model_id', subject.id)
    .select('permission_id')
    .get()
  return rows.map(r => Number(r.permission_id))
}

/**
 * Everything this model may do: its direct permissions plus everything its
 * roles grant, de-duplicated. This is the single function the Gate, the
 * middleware, and `hasPermissionTo` all go through.
 */
export async function permissionNamesFor(subject: Model | Subject, guard?: string): Promise<string[]> {
  const s = asSubject(subject)
  const catalogue = await permissionCatalogue()
  const [roleIds, directIds] = await Promise.all([attachedRoleIds(s), attachedPermissionIds(s)])

  const granted = new Set<number>(directIds)
  for (const role of catalogue.roles) {
    if (roleIds.includes(role.id)) {
      for (const id of role.permissionIds)
        granted.add(id)
    }
  }

  return catalogue.permissions
    .filter(p => granted.has(p.id) && guardMatches(p.guard, guard))
    .map(p => p.name)
    .sort()
}

/** Role names attached to this model; every guard unless one is named. */
export async function roleNamesFor(subject: Model | Subject, guard?: string): Promise<string[]> {
  const catalogue = await permissionCatalogue()
  const ids = await attachedRoleIds(asSubject(subject))
  return catalogue.roles
    .filter(r => ids.includes(r.id) && guardMatches(r.guard, guard))
    .map(r => r.name)
    .sort()
}

/** A model or an already-resolved subject, normalised. */
function asSubject(value: Model | Subject): Subject {
  return 'type' in value && 'id' in value && typeof value.type === 'string'
    ? value as Subject
    : subjectOf(value as Model)
}

/** Insert pivot rows, skipping ones already there (so assigning twice is harmless). */
async function attachModel(model: Model, pivotTable: string, column: string, ids: number[]): Promise<void> {
  if (ids.length === 0)
    return
  const { type, id } = subjectOf(model)
  const existing = new Set(
    (await table(pivotTable).where('model_type', type).where('model_id', id).select(column).get())
      .map(r => Number(r[column])),
  )
  // One statement per row: `insert` takes a single row, and a pivot attach is
  // a handful of rows at most.
  for (const value of ids.filter(value => !existing.has(value)))
    await table(pivotTable).insert({ [column]: value, model_type: type, model_id: id })
  await forgetPermissionCache()
}

async function detachModel(model: Model, pivotTable: string, column: string, ids?: number[]): Promise<void> {
  const { type, id } = subjectOf(model)
  const query = table(pivotTable).where('model_type', type).where('model_id', id)
  if (ids !== undefined) {
    if (ids.length === 0)
      return
    query.whereIn(column, ids)
  }
  await query.delete()
  await forgetPermissionCache()
}

export const HasRoles: Concern = {
  methods: {
    /** The Role models attached to this model. */
    async roles(this: Model): Promise<Role[]> {
      const ids = await attachedRoleIds(subjectOf(this))
      return ids.length === 0 ? [] : (await Role.query().whereIn('id', ids).get()).all()
    },

    /** Permissions attached DIRECTLY to this model (not the ones its roles grant). */
    async permissions(this: Model): Promise<Permission[]> {
      const ids = await attachedPermissionIds(subjectOf(this))
      return ids.length === 0 ? [] : (await Permission.query().whereIn('id', ids).get()).all()
    },

    async assignRole(this: Model, ...roles: Array<string | Role>): Promise<void> {
      const t = tableNames(permissionConfig())
      const ids = await resolveRoleIds(flatten(roles), writeGuard())
      await attachModel(this, t.modelHasRoles, 'role_id', ids)
    },

    async removeRole(this: Model, ...roles: Array<string | Role>): Promise<void> {
      const t = tableNames(permissionConfig())
      const ids = await resolveRoleIds(flatten(roles), writeGuard())
      await detachModel(this, t.modelHasRoles, 'role_id', ids)
    },

    /** Make these the model's roles exactly — anything else is removed. */
    async syncRoles(this: Model, ...roles: Array<string | Role>): Promise<void> {
      const t = tableNames(permissionConfig())
      const ids = await resolveRoleIds(flatten(roles), writeGuard())
      await detachModel(this, t.modelHasRoles, 'role_id')
      await attachModel(this, t.modelHasRoles, 'role_id', ids)
    },

    /** Any of them. `'admin|editor'`, `['admin', 'editor']`, or one name. */
    async hasRole(this: Model, roles: string | string[], guard?: string): Promise<boolean> {
      const names = await roleNamesFor(this, guard)
      return namesOf(roles).some(name => names.includes(name))
    },

    /** Alias of `hasRole` without the guard argument, as in Laravel. */
    async hasAnyRole(this: Model, ...roles: Array<string | string[]>): Promise<boolean> {
      const names = await roleNamesFor(this)
      return flatten(roles).flatMap(namesOf).some(name => names.includes(name))
    },

    async hasAllRoles(this: Model, roles: string | string[], guard?: string): Promise<boolean> {
      const names = await roleNamesFor(this, guard)
      return namesOf(roles).every(name => names.includes(name))
    },

    async givePermissionTo(this: Model, ...permissions: Array<string | Permission>): Promise<void> {
      const t = tableNames(permissionConfig())
      const ids = await resolvePermissionIds(flatten(permissions), writeGuard())
      await attachModel(this, t.modelHasPermissions, 'permission_id', ids)
    },

    async revokePermissionTo(this: Model, ...permissions: Array<string | Permission>): Promise<void> {
      const t = tableNames(permissionConfig())
      const ids = await resolvePermissionIds(flatten(permissions), writeGuard())
      await detachModel(this, t.modelHasPermissions, 'permission_id', ids)
    },

    async syncPermissions(this: Model, ...permissions: Array<string | Permission>): Promise<void> {
      const t = tableNames(permissionConfig())
      const ids = await resolvePermissionIds(flatten(permissions), writeGuard())
      await detachModel(this, t.modelHasPermissions, 'permission_id')
      await attachModel(this, t.modelHasPermissions, 'permission_id', ids)
    },

    /** Direct permissions AND those granted through roles. Accepts `'a|b'` for either. */
    async hasPermissionTo(this: Model, permission: string | string[], guard?: string): Promise<boolean> {
      const held = await permissionNamesFor(this, guard)
      return namesOf(permission).some(name => held.includes(name))
    },

    /** Every one of them, not just any. */
    async hasAllPermissions(this: Model, permissions: string | string[], guard?: string): Promise<boolean> {
      const held = await permissionNamesFor(this, guard)
      return namesOf(permissions).every(name => held.includes(name))
    },

    /** Only permissions attached straight to the model. */
    async hasDirectPermission(this: Model, permission: string, guard?: string): Promise<boolean> {
      const catalogue = await permissionCatalogue()
      const ids = await attachedPermissionIds(subjectOf(this))
      return catalogue.permissions.some(
        p => ids.includes(p.id) && p.name === permission && guardMatches(p.guard, guard),
      )
    },

    getRoleNames(this: Model): Promise<string[]> {
      return roleNamesFor(this)
    },

    getAllPermissions(this: Model): Promise<string[]> {
      return permissionNamesFor(this)
    },
  },
}
