import { authHasPlugin, webRoute } from '@elyvel/auth'
import { Inertia } from '@elyvel/inertia'

/**
 * Application web routes. `webRoute()` wires Better Auth in, so handlers get a
 * typed `user` and the `{ middleware: 'auth' }` guard — no `.use`, no `: any`.
 */

// Expose enabled auth features to every page (the settings nav hides Two-Factor
// when it's off). Shared once, merged into all page props.
Inertia.share('auth', { twoFactor: authHasPlugin('two-factor') })

export default webRoute()
  .get('/api/health', () => ({ status: 'ok' }))
  // Public landing — auth-aware (shows "Dashboard" when signed in), no redirect.
  .get('/', ({ user }) => Inertia.render('Welcome', { user }))
  .get('/dashboard', ({ user }) => Inertia.render('Dashboard', { user }), { middleware: 'auth' })
