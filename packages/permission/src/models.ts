/**
 * The two models this package stores: a `Role` (a bag of permissions you hand
 * to people) and a `Permission` (one thing someone may do). Both are ordinary
 * Eloquent models — query them, relate to them, extend them.
 *
 * Everything a *user* does goes through the `HasRoles` concern instead; these
 * classes are the storage side.
 */
import type { BelongsToMany } from '@elyvel/database'
import { Model } from '@elyvel/database'
import { DEFAULT_TABLES } from './config'

export interface RoleFields {
  id: number
  name: string
  guard: string
  created_at?: string
  updated_at?: string
}

export interface PermissionFields {
  id: number
  name: string
  guard: string
  created_at?: string
  updated_at?: string
}

// eslint-disable-next-line ts/no-unsafe-declaration-merging -- the interface only ADDS column types; it never conflicts with Model's own members
export interface Permission extends PermissionFields {}

// eslint-disable-next-line ts/no-unsafe-declaration-merging
export class Permission extends Model {
  static override table = DEFAULT_TABLES.permissions
  static override fillable = ['name', 'guard']

  /** Roles that grant this permission. */
  roles(): BelongsToMany<Role> {
    return this.belongsToMany(Role, DEFAULT_TABLES.roleHasPermissions, 'permission_id', 'role_id')
  }
}

// eslint-disable-next-line ts/no-unsafe-declaration-merging -- as above: column types only
export interface Role extends RoleFields {}

// eslint-disable-next-line ts/no-unsafe-declaration-merging
export class Role extends Model {
  static override table = DEFAULT_TABLES.roles
  static override fillable = ['name', 'guard']

  /** Permissions this role grants. */
  permissions(): BelongsToMany<Permission> {
    return this.belongsToMany(Permission, DEFAULT_TABLES.roleHasPermissions, 'role_id', 'permission_id')
  }
}
