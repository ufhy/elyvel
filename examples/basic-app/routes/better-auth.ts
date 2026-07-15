import { betterAuthPlugin } from '@elysia-ravel/auth'
import { route } from '@elysia-ravel/core'
import { auth } from '../app/better-auth'

/**
 * Better Auth routes. The plugin mounts `/api/auth/*` (sign-up, sign-in, session,
 * …) and derives `user`/`session` into context. `{ auth: true }` guards a route.
 * All auth data goes through the Eloquent adapter — one connection.
 */
export default route()
  .use(betterAuthPlugin(auth))
  .get('/account', ({ user }: any) => user, { auth: true })
  // `{ verified: true }` also requires a verified email (403 otherwise).
  .get('/billing', ({ user }: any) => ({ plan: 'pro', email: user.email }), { verified: true })
