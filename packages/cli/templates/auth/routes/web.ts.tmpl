import { authHasPlugin } from '@elysia-ravel/auth'
import { route } from '@elysia-ravel/core'
import { Inertia } from '@elysia-ravel/inertia'

/**
 * Application web routes. Inertia + the auth plugin are registered globally
 * (config/middleware.ts), so pages here need no `.use`: guard with the `auth`
 * middleware alias and read `user` straight from context.
 */

// Expose enabled auth features to every page (the settings nav hides Two-Factor
// when it's off). Shared once, merged into all page props.
Inertia.share('auth', { twoFactor: authHasPlugin('two-factor') })

export default route()
  .get('/api/health', () => ({ status: 'ok' }))
  // Public landing — auth-aware (shows "Dashboard" when signed in), no redirect.
  .get('/', ({ user }: any) => Inertia.render('Welcome', { user }))
  .get('/dashboard', ({ user }: any) => Inertia.render('Dashboard', { user }), { middleware: 'auth' })
