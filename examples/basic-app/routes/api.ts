import { requestContext } from '@elysia-ravel/core'
import { Elysia } from 'elysia'
import HelloController from '../app/controllers/HelloController'
import UserController from '../app/controllers/UserController'

/**
 * Route file. Anything default-exported here is auto-mounted by the framework.
 * Compose controllers with `.use()` — this is the Elysia-first replacement for
 * Laravel's route files + controller binding.
 */
export default new Elysia({ prefix: '/api' })
  // .use(requestContext()) gives handlers a typed, request-correlated `log`.
  .use(requestContext())
  .use(HelloController)
  .use(UserController)
  .get('/health', ({ log }) => {
    log.info('health check')
    return { status: 'ok' }
  })
