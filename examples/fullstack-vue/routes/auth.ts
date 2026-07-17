import type { User } from '@elysia-ravel/auth'
import { authHasPlugin, AuthToken, enabledSocialProviders, webRoute } from '@elysia-ravel/auth'
import { app } from '@elysia-ravel/core'
import { Inertia } from '@elysia-ravel/inertia'

/**
 * Authentication flow pages (login, register, password reset, email verify,
 * two-factor challenge). The Better Auth backend (`/api/auth/*`) is wired by
 * `webRoute()`; all auth actions call `/api/auth/*` from the client
 * (lib/auth.ts). Guest pages redirect to /dashboard when already signed in.
 */
type Props = Record<string, unknown>
function guest(page: string, props: Props | (() => Props) = {}) {
  return ({ user }: { user: User | null }) =>
    user ? Inertia.location('/dashboard') : Inertia.render(page, typeof props === 'function' ? props() : props)
}

// Enabled social providers, resolved per request from the bound auth instance.
const social = () => ({ socialProviders: enabledSocialProviders(app(AuthToken)) })

const twoFactorEnabled = authHasPlugin('two-factor')

const router = webRoute()
  .get('/login', guest('auth/Login', social))
  .get('/register', guest('auth/Register', social))
  .get('/forgot-password', guest('auth/ForgotPassword'))
  .get('/reset-password', guest('auth/ResetPassword'))
  .get('/verify-email', ({ user }) => Inertia.render('auth/VerifyEmail', { user }), { middleware: 'auth' })

// Sign-in 2FA challenge (reached when sign-in returns `twoFactorRedirect`); only
// when two-factor is enabled. Not guarded — the session is only half-established.
if (twoFactorEnabled)
  router.get('/two-factor', () => Inertia.render('auth/TwoFactorChallenge'))

export default router
