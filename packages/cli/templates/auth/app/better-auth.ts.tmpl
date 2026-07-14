import { eloquentAdapter } from '@elysia-ravel/auth'
import { Mail } from '@elysia-ravel/mail'
import { betterAuth } from 'better-auth'

/**
 * Better Auth, backed by the Eloquent adapter — one ORM, one connection.
 * Password-reset and email-verification links are delivered through
 * @elysia-ravel/mail (config/mail.ts). Add social providers/plugins here.
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
  secret: process.env.BETTER_AUTH_SECRET ?? process.env.APP_KEY ?? 'dev-only-secret-change-me-please!',
  baseURL: process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
})
