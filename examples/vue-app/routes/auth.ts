import { betterAuthPlugin } from '@elysia-ravel/auth'
import { route } from '@elysia-ravel/core'
import { Inertia, inertia } from '@elysia-ravel/inertia'
import { auth } from '../app/better-auth'

/**
 * Auth kit routes — Inertia + Vue pages backed by the Better Auth JSON API.
 * betterAuthPlugin mounts /api/auth/* + derives `user` + the `auth`/`verified`
 * macros. Guest pages redirect to /dashboard when already signed in; app pages
 * require auth. All auth actions call /api/auth/* from the client (lib/auth.ts).
 */
function guest(page: string) {
  return ({ user }: any) =>
    user ? Inertia.location('/dashboard') : Inertia.render(page)
}

export default route()
  .use(
    inertia({ vite: { entry: 'resources/js/app.ts' }, ssr: { bundle: 'public/build/ssr/ssr.js' } }),
  )
  .use(betterAuthPlugin(auth))
  .get('/login', guest('auth/Login'))
  .get('/register', guest('auth/Register'))
  .get('/forgot-password', guest('auth/ForgotPassword'))
  .get('/reset-password', guest('auth/ResetPassword'))
  .get('/dashboard', ({ user }: any) => Inertia.render('Dashboard', { user }), { auth: true })
  .get('/settings/profile', ({ user }: any) => Inertia.render('settings/Profile', { user }), {
    auth: true,
  })
  .get('/settings/password', ({ user }: any) => Inertia.render('settings/Password', { user }), {
    auth: true,
  })
  .get('/verify-email', ({ user }: any) => Inertia.render('auth/VerifyEmail', { user }), {
    auth: true,
  })
