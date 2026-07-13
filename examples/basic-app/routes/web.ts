import { Hash } from '@elysia-ravel/auth'
import { type MiddlewareContext, redirect, requestContext, route } from '@elysia-ravel/core'
import { view } from '@elysia-ravel/view'
import { User } from '../app/models/User'
import { StoreUserRequest } from '../app/requests/StoreUserRequest'
import { RegisterForm } from '../app/views/RegisterForm'

/**
 * Server-rendered web routes — the full-stack lane. The register form shows the
 * complete Laravel-style loop: GET renders the form; POST validates and, on
 * failure, the framework redirects back with errors + old input flashed (no
 * code needed here); on success it redirects with a status message.
 */
export default route()
  .use(requestContext())
  .get('/register', () => view(RegisterForm))
  .post(
    '/register',
    async (ctx) => {
      const data = await StoreUserRequest.validate(ctx as unknown as MiddlewareContext)
      await User.create({
        name: String(data.name),
        email: String(data.email),
        password: await Hash.make(String(data.password)),
      })
      return redirect('/register').with('status', 'Account created!')
    },
    { middleware: ['csrf'] },
  )
