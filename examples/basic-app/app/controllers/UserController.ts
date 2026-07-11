import { Elysia, t } from 'elysia'
import { User } from '../models/User'

/** UserController — DB-backed resource. Passwords are hidden by the model. */
export default new Elysia({ name: 'users', prefix: '/users' })
  .get('/', async () => (await User.all()).toArray())
  .get(
    '/:id',
    async ({ params, status }) => {
      const user = await User.find(params.id)
      return user ? user.toJSON() : status(404, { message: 'User not found' })
    },
    { params: t.Object({ id: t.Number() }) },
  )
