import { defineAuthConfig } from '@elysia-ravel/auth'
import { Mail } from '@elysia-ravel/mail'

/**
 * Authentication (Better Auth) config — plain data, like every other
 * `config/*.ts`, so it lands in the config repository (`config('auth.twoFactor')`)
 * and is shared to the frontend. The instance is built from this by
 * `AuthServiceProvider` (registered in `config/app.ts`).
 *
 * - `social`: a provider turns on only when its env credentials are set
 *   (e.g. GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET) — opt-in per deploy.
 * - `twoFactor`: TOTP + backup codes (adds the `twoFactor` table). Set `false`
 *   to drop the plugin AND hide its routes + settings nav entry.
 * - Need a raw Better Auth option? Pass `betterAuth: { ... }`.
 */
export default defineAuthConfig({
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
