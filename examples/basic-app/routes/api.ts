import { requestContext, resource, route } from '@elysia-ravel/core'
import HelloController from '../app/controllers/HelloController'
import { UserController } from '../app/controllers/UserController'
import { User } from '../app/models/User'

/**
 * Route file. Anything default-exported here is auto-mounted by the framework.
 * Use `route()` instead of `new Elysia()` to get the `middleware` macro, then
 * apply named middleware per-route with `{ middleware: '...' }`.
 */
export default route('/api')
  // .use(requestContext()) gives handlers a typed, request-correlated `log`.
  .use(requestContext())
  .use(HelloController)
  // RESTful resource → UserController; `json` guards writes; `bind` resolves :id → User.
  .use(resource('/users', UserController, { middleware: { store: ['json'] }, bind: User }))
  .get('/health', ({ log }) => {
    log.info('health check')
    return { status: 'ok' }
  })
  // Route-level middleware alias — `json` rejects non-JSON writes (config/middleware.ts).
  .post('/echo', ({ body }) => ({ echoed: body }), { middleware: 'json' })
