import { authHasPlugin, webRoute } from '@elysia-ravel/auth'
import { Inertia } from '@elysia-ravel/inertia'

/**
 * Settings routes (profile, password, appearance, two-factor) — all require an
 * authenticated user. Two-factor is registered only when enabled in config/auth.ts.
 */
const twoFactorEnabled = authHasPlugin('two-factor')

const router = webRoute()
  .get('/settings/profile', ({ user }) => Inertia.render('settings/Profile', { user }), { middleware: 'auth' })
  .get('/settings/password', ({ user }) => Inertia.render('settings/Password', { user }), { middleware: 'auth' })
  .get('/settings/appearance', ({ user }) => Inertia.render('settings/Appearance', { user }), { middleware: 'auth' })

if (twoFactorEnabled)
  router.get('/settings/two-factor', ({ user }) => Inertia.render('settings/TwoFactor', { user }), { middleware: 'auth' })

export default router
