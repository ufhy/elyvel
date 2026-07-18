import { defineAuthConfig } from '@elyvel/auth'
import { Mail } from '@elyvel/mail'
import { twoFactor } from 'better-auth/plugins'

/**
 * Authentication config — **native Better Auth options**. The framework fills in
 * the glue (Eloquent adapter, APP_KEY secret, base URL, cookie prefix, plural
 * table names); everything here is standard Better Auth, so its docs apply
 * directly. Plain data, so it lands in the config repository and is shared to
 * the frontend; the instance is built by `AuthServiceProvider` (config/app.ts).
 */
export default defineAuthConfig({
  // Features are plugins — add/remove freely (e.g. passkey(), organization()).
  // `twoFactor` adds TOTP + backup codes; drop it to turn two-factor off.
  plugins: [twoFactor()],

  // Social sign-in — a provider is offered only when its env credentials exist.
  socialProviders: {
    ...(process.env.GITHUB_CLIENT_ID && {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
      },
    }),
    ...(process.env.GOOGLE_CLIENT_ID && {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      },
    }),
  },

  emailAndPassword: {
    enabled: true,
    sendResetPassword: ({ user, url }) =>
      Mail.to(user.email)
        .subject('Reset your password')
        .html(`<p>Hi ${user.name ?? ''},</p><p>Reset your password: <a href="${url}">${url}</a></p>`)
        .send(),
  },
  emailVerification: {
    sendVerificationEmail: ({ user, url }) =>
      Mail.to(user.email)
        .subject('Verify your email address')
        .html(`<p>Hi ${user.name ?? ''},</p><p>Verify your email: <a href="${url}">${url}</a></p>`)
        .send(),
  },
})
