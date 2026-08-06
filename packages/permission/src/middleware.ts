/**
 * Route guards, mirroring spatie's three middleware:
 *
 *   route().get('/admin', handler, { middleware: 'role:admin|editor' })
 *   route().post('/posts', handler, { middleware: 'permission:create posts' })
 *   route().get('/panel', handler, { middleware: 'role_or_permission:admin|view panel' })
 *
 * A pipe means "any of these", matching Laravel. A second argument narrows the
 * guard: `role:admin,api`.
 *
 * Not logged in is 403, not 401 — the same choice spatie makes
 * (`UnauthorizedException::notLoggedIn()` is a 403): the route exists and the
 * request is answerable, the caller simply may not have it.
 */
import type { MiddlewareContext } from '@elyvel/core'
import type { Subject } from './subject'
import { Middleware } from '@elyvel/core'
import { permissionNamesFor, roleNamesFor } from './concern'
import { currentPermissions, loadPermissionsInto } from './context'
import { subjectFromUser } from './subject'

function split(spec: string | undefined): string[] {
  return (spec ?? '').split('|').map(v => v.trim()).filter(Boolean)
}

/**
 * The authenticated subject, however the app's auth layer exposed `user` —
 * an Eloquent model, or a plain object plus `permission.userModel`.
 */
function userOf(context: MiddlewareContext): Subject | undefined {
  return subjectFromUser(context.user)
}

function forbid(context: MiddlewareContext, message: string): unknown {
  return context.status(403, { message })
}

/**
 * Loads the current user's roles and permissions into request Context so
 * `Gate` can answer synchronously. Put it in the `web`/`api` group *after*
 * whatever authenticates the request; without it the Gate integration
 * abstains and you must use `await user.hasPermissionTo(...)` directly.
 */
export class PermissionContextMiddleware extends Middleware {
  async handle(context: MiddlewareContext): Promise<void> {
    const user = userOf(context)
    if (user)
      await loadPermissionsInto(user)
  }
}

/** `role:admin|editor[,guard]` */
export class RoleMiddleware extends Middleware {
  async handle(context: MiddlewareContext, roles?: string, guard?: string): Promise<unknown> {
    const user = userOf(context)
    if (!user)
      return forbid(context, 'User is not logged in.')

    const wanted = split(roles)
    const held = guard === undefined
      ? (currentPermissions()?.roles ?? await roleNamesFor(user))
      : await roleNamesFor(user, guard)

    if (wanted.some(name => held.includes(name)))
      return undefined
    return forbid(context, `User does not have the right roles. Necessary roles are ${wanted.join(', ')}`)
  }
}

/** `permission:edit posts|delete posts[,guard]` */
export class PermissionMiddleware extends Middleware {
  async handle(context: MiddlewareContext, permissions?: string, guard?: string): Promise<unknown> {
    const user = userOf(context)
    if (!user)
      return forbid(context, 'User is not logged in.')

    const wanted = split(permissions)
    const held = guard === undefined
      ? (currentPermissions()?.permissions ?? await permissionNamesFor(user))
      : await permissionNamesFor(user, guard)

    if (wanted.some(name => held.includes(name)))
      return undefined
    return forbid(
      context,
      `User does not have the right permissions. Necessary permissions are ${wanted.join(', ')}`,
    )
  }
}

/** `role_or_permission:admin|edit posts[,guard]` — either side is enough. */
export class RoleOrPermissionMiddleware extends Middleware {
  async handle(context: MiddlewareContext, spec?: string, guard?: string): Promise<unknown> {
    const user = userOf(context)
    if (!user)
      return forbid(context, 'User is not logged in.')

    const wanted = split(spec)
    const loaded = guard === undefined ? currentPermissions() : undefined
    const [roles, permissions] = loaded
      ? [loaded.roles, loaded.permissions]
      : await Promise.all([roleNamesFor(user, guard), permissionNamesFor(user, guard)])

    if (wanted.some(name => roles.includes(name) || permissions.includes(name)))
      return undefined
    return forbid(
      context,
      `User does not have any of the necessary access rights. Necessary roles or permissions are ${wanted.join(', ')}`,
    )
  }
}

/** Ready to spread into `config/middleware.ts` `aliases`. */
export const permissionMiddlewareAliases = {
  permissions: PermissionContextMiddleware,
  role: RoleMiddleware,
  permission: PermissionMiddleware,
  role_or_permission: RoleOrPermissionMiddleware,
}
