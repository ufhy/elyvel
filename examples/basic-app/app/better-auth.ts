import { eloquentAdapter } from '@elysia-ravel/auth'
import { betterAuth } from 'better-auth'

/**
 * Better Auth, backed by the Eloquent adapter — no separate DB connection or
 * ORM. Email+password enabled; add social providers/plugins here as needed.
 */
export const auth = betterAuth({
  database: eloquentAdapter(),
  emailAndPassword: { enabled: true },
  secret: process.env.BETTER_AUTH_SECRET ?? process.env.APP_KEY ?? 'dev-only-secret-change-me-please!',
  baseURL: process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
})
