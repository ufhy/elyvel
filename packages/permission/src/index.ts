/**
 * @elyvel/permission — roles and permissions in the database, in the spirit of
 * spatie/laravel-permission.
 *
 *   export class User extends Model {}
 *   withConcerns(User, HasRoles)
 *
 *   await Role.create({ name: 'writer', guard: 'web' })
 *   await user.assignRole('writer')
 *   await user.hasPermissionTo('edit posts')
 *
 * Roles attach to ANY model through a polymorphic pivot, not just users. Inside
 * a request, add `PermissionContextMiddleware` and the `Gate` answers
 * permission abilities for you — see `context.ts` for why that middleware
 * exists rather than a direct database call from the Gate.
 */
import { PermissionServiceProvider } from './provider'

export { HasRoles, type HasRolesFields, permissionNamesFor, roleNamesFor } from './concern'
export {
  DEFAULT_GUARD,
  definePermissionConfig,
  type PermissionConfig,
  tableNames,
} from './config'
export {
  currentPermissions,
  forgetLoadedPermissions,
  type LoadedPermissions,
  loadPermissionsInto,
} from './context'
export {
  PermissionContextMiddleware,
  PermissionMiddleware,
  permissionMiddlewareAliases,
  RoleMiddleware,
  RoleOrPermissionMiddleware,
} from './middleware'
export {
  Permission,
  type PermissionFields,
  Role,
  type RoleFields,
} from './models'
export { PermissionServiceProvider } from './provider'
export {
  forgetPermissionCache,
  type PermissionCatalogue,
  permissionCatalogue,
} from './registrar'
export { migratePermissionTables, rollbackPermissionTables } from './schema'
export { type Subject, subjectFromUser, subjectOf } from './subject'

export const elyvelProviders = [PermissionServiceProvider]
