/**
 * The permission catalogue — every role and permission that exists, plus which
 * permissions each role grants — held in the cache so a check costs one small
 * pivot lookup instead of a join across five tables.
 *
 * What is NOT cached here: who has what. Assignments are per-model and change
 * far more often; those are read per model (and, inside a request, held in
 * Context by `PermissionContextMiddleware` so they're read once).
 *
 * Every write through this package calls {@link forgetPermissionCache}, so a
 * stale catalogue is not something an app has to think about — the one case it
 * must is a hand-written SQL INSERT into the tables, which nothing can observe.
 */
import type { PermissionConfig } from './config'
import { cache } from '@elyvel/cache'
import { table } from '@elyvel/database'
import { DEFAULT_CACHE_KEY, DEFAULT_CACHE_SECONDS, tableNames } from './config'
import { Permission, Role } from './models'

/** One role, with the ids of the permissions it grants. */
export interface CachedRole {
  id: number
  name: string
  guard: string
  permissionIds: number[]
}

export interface CachedPermission {
  id: number
  name: string
  guard: string
}

/** The whole catalogue, in the plain shape that survives a JSON round-trip. */
export interface PermissionCatalogue {
  roles: CachedRole[]
  permissions: CachedPermission[]
}

let config: PermissionConfig | undefined

/**
 * Called by the service provider (and the CLI, and tests) once
 * `config/permission.ts` is known.
 *
 * This is also where the models learn their table names. They can't read the
 * config at class-definition time — it isn't loaded yet — so a `tables`
 * override would otherwise apply to the migration and the pivot queries but
 * NOT to `Role.query()`, leaving the models pointed at tables that were never
 * created. One choke point keeps every path in agreement.
 */
export function configurePermissions(next: PermissionConfig | undefined): void {
  config = next
  const t = tableNames(next)
  Role.table = t.roles
  Permission.table = t.permissions
}

export function permissionConfig(): PermissionConfig | undefined {
  return config
}

function cacheKey(): string {
  return config?.cacheKey ?? DEFAULT_CACHE_KEY
}

/**
 * The cache repository, or `null` when the app has no usable cache. A cache
 * that can't be built is not a reason to refuse to authorize — we fall back to
 * reading the tables every time, which is correct, just slower.
 */
function store(): { get(k: string): Promise<unknown>, put(k: string, v: unknown, s?: number): Promise<void>, forget(k: string): Promise<void> } | null {
  try {
    return cache()
  }
  catch {
    return null
  }
}

/** Read the catalogue straight from the database. */
async function loadCatalogue(): Promise<PermissionCatalogue> {
  const t = tableNames(config)
  const [permissions, roles, pivots] = await Promise.all([
    table(t.permissions).select('id', 'name', 'guard').get(),
    table(t.roles).select('id', 'name', 'guard').get(),
    table(t.roleHasPermissions).select('role_id', 'permission_id').get(),
  ])

  const byRole = new Map<number, number[]>()
  for (const pivot of pivots) {
    const roleId = Number(pivot.role_id)
    const list = byRole.get(roleId) ?? []
    list.push(Number(pivot.permission_id))
    byRole.set(roleId, list)
  }

  return {
    permissions: permissions.map(p => ({ id: Number(p.id), name: String(p.name), guard: String(p.guard) })),
    roles: roles.map(r => ({
      id: Number(r.id),
      name: String(r.name),
      guard: String(r.guard),
      permissionIds: byRole.get(Number(r.id)) ?? [],
    })),
  }
}

/** The catalogue, from cache when possible. */
export async function permissionCatalogue(): Promise<PermissionCatalogue> {
  const repo = store()
  if (!repo)
    return loadCatalogue()

  const cached = (await repo.get(cacheKey())) as PermissionCatalogue | undefined
  if (cached && Array.isArray(cached.roles) && Array.isArray(cached.permissions))
    return cached

  const fresh = await loadCatalogue()
  await repo.put(cacheKey(), fresh, config?.cacheSeconds ?? DEFAULT_CACHE_SECONDS)
  return fresh
}

/** Drop the cached catalogue — every write in this package calls this. */
export async function forgetPermissionCache(): Promise<void> {
  await store()?.forget(cacheKey())
}
