import { AuthToken, authHasPlugin, enabledSocialProviders } from '@elysia-ravel/auth'
import { app, route } from '@elysia-ravel/core'

/**
 * JSON API for the SPA. Auth actions live at `/api/auth/*` (Better Auth, mounted
 * globally by betterAuthPlugin); this adds app endpoints. `user` is derived
 * globally, so `{ middleware: 'auth' }` protects routes and reads it from context.
 */
export default route()
  // Feature flags + enabled social providers for the client (login page, nav).
  .get('/api/config', () => ({
    social: enabledSocialProviders(app(AuthToken)),
    twoFactor: authHasPlugin('two-factor'),
  }))
  // The authenticated user (SPA also uses /api/auth/get-session directly).
  .get('/api/user', ({ user }: any) => ({ user }), { middleware: 'auth' })
