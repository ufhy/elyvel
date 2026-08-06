/**
 * Shape of `config/permission.ts`. Everything has a working default, so an app
 * that never writes the file still gets the standard table layout.
 */
export interface PermissionConfig {
  /** Table names, in case they clash with something the app already owns. */
  tables?: {
    roles?: string
    permissions?: string
    modelHasRoles?: string
    modelHasPermissions?: string
    roleHasPermissions?: string
  }
  /**
   * The guard a role/permission belongs to when none is given — the same idea
   * as Laravel's `guard_name`: one app can hand out "admin" to a web user and
   * a different "admin" to an API token without the two colliding.
   */
  defaultGuard?: string
  /**
   * The model the authenticated user corresponds to, e.g. `AuthUser`.
   *
   * Needed only because `ctx.user` is a plain object with Better Auth rather
   * than an Eloquent model: its class name is what gets written to
   * `model_type`, so the middleware must be told which model that is. Apps
   * whose `ctx.user` IS a model instance can leave this unset.
   */
  userModel?: { name: string }
  /** How long the permission→roles map is cached, in seconds. Default 24h. */
  cacheSeconds?: number
  /** Cache key holding that map. */
  cacheKey?: string
  /**
   * Wire `Gate` so `gate.allows('edit posts', user)` consults permissions.
   * Default true. See `PermissionContextMiddleware` for why this is
   * request-scoped.
   */
  registerGate?: boolean
}

export function definePermissionConfig(config: PermissionConfig): PermissionConfig {
  return config
}

/** Defaults merged under whatever `config/permission.ts` provides. */
export const DEFAULT_TABLES = {
  roles: 'roles',
  permissions: 'permissions',
  modelHasRoles: 'model_has_roles',
  modelHasPermissions: 'model_has_permissions',
  roleHasPermissions: 'role_has_permissions',
} as const

export const DEFAULT_GUARD = 'web'
export const DEFAULT_CACHE_KEY = 'elyvel.permission.cache'
export const DEFAULT_CACHE_SECONDS = 24 * 60 * 60

/** The resolved table names — config over defaults. */
export function tableNames(config: PermissionConfig | undefined): Required<NonNullable<PermissionConfig['tables']>> {
  return { ...DEFAULT_TABLES, ...(config?.tables ?? {}) }
}
