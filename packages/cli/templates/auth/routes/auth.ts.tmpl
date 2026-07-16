import { betterAuthPlugin, enabledSocialProviders } from '@elysia-ravel/auth'
import { route } from '@elysia-ravel/core'
import { Inertia, inertia } from '@elysia-ravel/inertia'
import { auth } from '../config/auth'

/**
 * Auth kit routes — Inertia + Vue pages backed by the Better Auth JSON API.
 * betterAuthPlugin mounts /api/auth/* + derives `user` + the `auth`/`verified`
 * macros. Guest pages redirect to /dashboard when already signed in; app pages
 * require auth. All auth actions call /api/auth/* from the client (lib/auth.ts).
 */
function guest(page: string, props: Record<string, unknown> = {}) {
  return ({ user }: any) =>
    user ? Inertia.location('/dashboard') : Inertia.render(page, props)
}

const social = { socialProviders: enabledSocialProviders(auth) }

// Applies the saved light/dark preference to <html> before first paint (no flash).
const themeScript = `<script>(function(){try{var a=localStorage.getItem('appearance')||'system';if(a==='dark'||(a==='system'&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}})()</script>`

export default route()
  .use(inertia({ vite: { entry: 'resources/js/app.ts' }, ssr: { bundle: 'public/build/ssr/ssr.js' }, head: themeScript }))
  .use(betterAuthPlugin(auth))
  // Public landing — auth-aware (shows "Dashboard" when signed in), no redirect.
  .get('/', ({ user }: any) => Inertia.render('Welcome', { user }))
  .get('/login', guest('auth/Login', social))
  .get('/register', guest('auth/Register', social))
  .get('/forgot-password', guest('auth/ForgotPassword'))
  .get('/reset-password', guest('auth/ResetPassword'))
  // Sign-in 2FA challenge: reached when sign-in returns `twoFactorRedirect`.
  // Not `auth`-guarded — the session is only half-established at this point.
  .get('/two-factor', () => Inertia.render('auth/TwoFactorChallenge'))
  .get('/dashboard', ({ user }: any) => Inertia.render('Dashboard', { user }), { auth: true })
  .get('/settings/profile', ({ user }: any) => Inertia.render('settings/Profile', { user }), { auth: true })
  .get('/settings/password', ({ user }: any) => Inertia.render('settings/Password', { user }), { auth: true })
  .get('/settings/two-factor', ({ user }: any) => Inertia.render('settings/TwoFactor', { user }), { auth: true })
  .get('/settings/appearance', ({ user }: any) => Inertia.render('settings/Appearance', { user }), { auth: true })
  .get('/verify-email', ({ user }: any) => Inertia.render('auth/VerifyEmail', { user }), { auth: true })
