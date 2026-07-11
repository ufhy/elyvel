import { Elysia, t } from 'elysia'
import { User } from '../models/User'

/** Hide the password hash from API responses. */
const publicUser = ({ password: _pw, ...rest }: Awaited<ReturnType<typeof User.all>>[number]) => rest

/** UserController — a DB-backed resource, fully typed end to end. */
export default new Elysia({ name: 'users', prefix: '/users' })
  .get('/', async () => (await User.all()).map(publicUser))
  .get(
    '/:id',
    async ({ params, status }) => {
      const user = await User.find(params.id)
      return user ? publicUser(user) : status(404, { message: 'User not found' })
    },
    { params: t.Object({ id: t.Number() }) },
  )
