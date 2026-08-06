/**
 * Wires the package into an app: reads `config/permission.ts`, and teaches the
 * Gate to consult permissions so `gate.allows('edit posts', user)` and
 * `@Authorize('edit posts')` work without every ability being defined by hand
 * — Laravel's `Gate::before` registration in `PermissionServiceProvider`.
 */
import { gate } from '@elyvel/auth'
import { ServiceProvider } from '@elyvel/core'
import { currentPermissions } from './context'
import { configurePermissions } from './registrar'

export class PermissionServiceProvider extends ServiceProvider {
  override register(): void {
    configurePermissions(this.app.config.get('permission', undefined))
  }

  override boot(): void {
    if (this.app.config.get<boolean>('permission.registerGate', true) === false)
      return

    // Synchronous by necessity — see `context.ts`. Returning undefined means
    // "no opinion", so abilities the app defined itself still decide, and a
    // request that never ran PermissionContextMiddleware is unaffected rather
    // than silently denied.
    gate().before((_user, ability) => {
      const loaded = currentPermissions()
      if (!loaded)
        return undefined
      return loaded.permissions.includes(ability) ? true : undefined
    })
  }
}
