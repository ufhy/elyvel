/**
 * The bridge between an async permission store and a synchronous Gate.
 *
 * `Gate` is deliberately synchronous, and throws if an ability returns a
 * Promise — a past bug where an async policy returned a truthy Promise and
 * authorized everything is why. Permission checks read the database, so they
 * can't be plugged straight into it.
 *
 * The way out is to resolve once and remember: `PermissionContextMiddleware`
 * loads the authenticated user's role and permission names into
 * request-scoped {@link Context} at the top of the request, and the Gate hook
 * then answers from that in-memory set — synchronously, no await, no
 * fail-open. Outside a request (jobs, CLI, tinker) nothing is preloaded and
 * the Gate hook simply abstains; use the model's own `await user.can*` methods
 * there.
 */
import type { Model } from '@elyvel/database'
import type { Subject } from './subject'
import { Context } from '@elyvel/core'
import { permissionNamesFor, roleNamesFor } from './concern'

const ROLES_KEY = 'permission.roles'
const PERMISSIONS_KEY = 'permission.permissions'
const LOADED_KEY = 'permission.loaded'

/** Names loaded for the current request, or undefined outside one. */
export interface LoadedPermissions {
  roles: string[]
  permissions: string[]
}

/**
 * Read a model's names and stash them for the rest of the request. Safe to
 * call more than once — the second call is a no-op, which is what makes the
 * middleware and a manual call in a handler compose.
 */
export async function loadPermissionsInto(subject: Model | Subject): Promise<LoadedPermissions> {
  const existing = currentPermissions()
  if (existing)
    return existing

  const [roles, permissions] = await Promise.all([roleNamesFor(subject), permissionNamesFor(subject)])
  Context.addHidden(ROLES_KEY, roles)
  Context.addHidden(PERMISSIONS_KEY, permissions)
  Context.addHidden(LOADED_KEY, true)
  return { roles, permissions }
}

/**
 * What was loaded for this request, or `undefined` when nothing was — the two
 * are different answers and callers must not confuse them: "no permissions"
 * denies, "not loaded" abstains.
 *
 * Hidden context, so these names never leak into log lines the way ordinary
 * context values do.
 */
export function currentPermissions(): LoadedPermissions | undefined {
  if (!Context.getHidden<boolean>(LOADED_KEY))
    return undefined
  return {
    roles: Context.getHidden<string[]>(ROLES_KEY) ?? [],
    permissions: Context.getHidden<string[]>(PERMISSIONS_KEY) ?? [],
  }
}

/** Drop the loaded names — call after changing a user's roles mid-request. */
export function forgetLoadedPermissions(): void {
  Context.forgetHidden(ROLES_KEY)
  Context.forgetHidden(PERMISSIONS_KEY)
  Context.forgetHidden(LOADED_KEY)
}
