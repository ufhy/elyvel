import { Elysia, t } from 'elysia'
import { auth } from '../app/auth'

/**
 * Auth routes. `.use(auth.guard())` derives a typed `user` into context and
 * enables the `{ auth: true }` macro to protect routes.
 */
export default new Elysia({ prefix: '/auth' })
  .use(auth.guard())
  .post(
    '/login',
    async ({ body, status }) => {
      const result = await auth.attempt(body)
      if (!result) return status(401, { message: 'Invalid credentials' })

      const { password: _pw, ...user } = result.user
      return { user, token: result.token }
    },
    { body: t.Object({ email: t.String({ format: 'email' }), password: t.String() }) },
  )
  .get(
    '/me',
    ({ user, status }) => {
      if (!user) return status(401, { message: 'Unauthenticated' })
      const { password: _pw, ...rest } = user
      return rest
    },
    { auth: true },
  )
  .post(
    '/logout',
    async ({ authToken }) => {
      if (authToken) await auth.logout(authToken)
      return { ok: true }
    },
    { auth: true },
  )
