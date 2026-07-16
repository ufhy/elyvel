import { defineAuth } from '@elysia-ravel/auth'
import { Mail } from '@elysia-ravel/mail'

/**
 * Authentication (Better Auth). `defineAuth` wires the framework glue for you —
 * the Eloquent adapter, the signing secret (from APP_KEY), the base URL, and a
 * per-app cookie prefix (a slug of APP_NAME, so cookies aren't `better-auth.*`).
 *
 * - `social`: a provider turns on only when its env credentials are set
 *   (e.g. GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET) — opt-in per deploy.
 * - `twoFactor`: TOTP + backup codes (adds the `twoFactor` table).
 * - Need a raw Better Auth option? Pass `betterAuth: { ... }`.
 */
export const auth = defineAuth({
  social: ['github', 'google'],
  twoFactor: true,
  sendResetPassword: ({ user, url }) =>
    Mail.to(user.email)
      .subject('Reset your password')
      .html(`<p>Hi ${user.name ?? ''},</p><p>Reset your password: <a href="${url}">${url}</a></p>`)
      .send(),
  sendVerificationEmail: ({ user, url }) =>
    Mail.to(user.email)
      .subject('Verify your email address')
      .html(`<p>Hi ${user.name ?? ''},</p><p>Verify your email: <a href="${url}">${url}</a></p>`)
      .send(),
})
