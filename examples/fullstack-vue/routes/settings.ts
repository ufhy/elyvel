import { config, route } from '@elysia-ravel/core'
import { Inertia } from '@elysia-ravel/inertia'

/**
 * Settings routes (profile, password, appearance, two-factor) — all require an
 * authenticated user. Two-factor is registered only when enabled in
 * config/auth.ts. The `auth` guard + `user` come from the global middleware.
 */
const twoFactorEnabled = config<boolean>('auth.twoFactor', true) !== false

const router = route()
  .get('/settings/profile', ({ user }: any) => Inertia.render('settings/Profile', { user }), { middleware: 'auth' })
  .get('/settings/password', ({ user }: any) => Inertia.render('settings/Password', { user }), { middleware: 'auth' })
  .get('/settings/appearance', ({ user }: any) => Inertia.render('settings/Appearance', { user }), { middleware: 'auth' })

if (twoFactorEnabled)
  router.get('/settings/two-factor', ({ user }: any) => Inertia.render('settings/TwoFactor', { user }), { middleware: 'auth' })

export default router
