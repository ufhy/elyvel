import { eloquentAdapter } from '@elysia-ravel/auth'
import { Mail } from '@elysia-ravel/mail'
import { betterAuth } from 'better-auth'
import { twoFactor } from 'better-auth/plugins'

/**
 * Social providers are opt-in: a provider only turns on when BOTH its client id
 * and secret are present in the environment. Set GITHUB_CLIENT_ID/SECRET or
 * GOOGLE_CLIENT_ID/SECRET in .env to enable them (add more providers here).
 */
function socialProviders(): Record<string, { clientId: string, clientSecret: string }> {
  const providers: Record<string, { clientId: string, clientSecret: string }> = {}
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    providers.github = {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    }
  }
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    providers.google = {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }
  }
  return providers
}

const SOCIAL = socialProviders()

/** Provider names the app is configured for — the login/register UI renders a button per entry. */
export function enabledSocialProviders(): string[] {
  return Object.keys(SOCIAL)
}

/**
 * Better Auth, backed by the Eloquent adapter — one ORM, one connection.
 * Password-reset and email-verification links are delivered through
 * @elysia-ravel/mail (config/mail.ts). Two-factor auth (TOTP + backup codes) is
 * enabled via the twoFactor() plugin; social providers are opt-in (see above).
 */
export const auth = betterAuth({
  database: eloquentAdapter(),
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      await Mail.to(user.email)
        .subject('Reset your password')
        .html(`<p>Hi ${user.name ?? ''},</p><p>Reset your password: <a href="${url}">${url}</a></p>`)
        .send()
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      await Mail.to(user.email)
        .subject('Verify your email address')
        .html(`<p>Hi ${user.name ?? ''},</p><p>Verify your email: <a href="${url}">${url}</a></p>`)
        .send()
    },
  },
  socialProviders: SOCIAL,
  plugins: [twoFactor({ issuer: process.env.APP_NAME ?? 'elysia-ravel' })],
  // Session-signing secret. Required — the app already refuses to boot without
  // APP_KEY (cookie session driver), so this is always set in practice. Never
  // ship a hardcoded fallback: a known secret means forgeable sessions.
  secret: process.env.BETTER_AUTH_SECRET ?? process.env.APP_KEY,
  baseURL: process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
})
