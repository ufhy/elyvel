import { cache } from '@elysia-ravel/cache'
import { requestContext, Resource, resource, route } from '@elysia-ravel/core'
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
  // RESTful resource → UserController; `json` guards writes; `bind` resolves :id → User;
  // `name` registers `users.index`/`users.show`/… for urlFor().
  .use(
    resource('/users', UserController, {
      middleware: { store: ['json'] },
      bind: User,
      name: 'users',
    }),
  )
  .get('/health', ({ log }) => {
    log.info('health check')
    return { status: 'ok' }
  })
  // API resource envelope: `{ data: [...] }` — the same transformer could feed
  // Inertia page props on the web lane.
  .get('/users-resource', async () => {
    const users = (await User.all()).toArray()
    return Resource.collection(users, u => (u as User).toJSON())
  })
  // Cache demo: the user count is computed once, then served from cache for 60s.
  .get('/stats', async () => {
    const users = await cache().remember('stats.users', 60, () => User.query().count())
    return { users }
  })
  // Session demo: a per-visitor counter persisted in the (cookie) session.
  .get('/visits', ({ session }: any) => {
    const count = (session.get('visits') ?? 0) + 1
    session.put('visits', count)
    return { visits: count, csrfToken: session.token() }
  })
  // Route-level aliases — `json` rejects non-JSON writes; `throttle` rate-limits (built-in).
  .post('/echo', ({ body }) => ({ echoed: body }), { middleware: ['json', 'throttle:5,1'] })
  // `csrf` (built-in) protects this write — needs a valid session token.
  .post('/secure', ({ body }: any) => ({ ok: true, body }), { middleware: ['json', 'csrf'] })
