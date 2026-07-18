import { authHasPlugin, AuthToken, enabledSocialProviders, webRoute } from '@elyvel/auth'
import { app } from '@elyvel/core'

/**
 * JSON API for the SPA. Auth actions live at `/api/auth/*` (Better Auth, wired
 * by webRoute); this adds app endpoints. `webRoute()` gives a typed `user` and
 * the `{ middleware: 'auth' }` guard.
 */
export default webRoute()
  // Feature flags + enabled social providers for the client (login page, nav).
  .get('/api/config', () => ({
    social: enabledSocialProviders(app(AuthToken)),
    twoFactor: authHasPlugin('two-factor'),
  }))
  // The authenticated user (SPA also uses /api/auth/get-session directly).
  .get('/api/user', ({ user }) => ({ user }), { middleware: 'auth' })
