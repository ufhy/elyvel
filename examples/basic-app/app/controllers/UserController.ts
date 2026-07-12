import { Controller, type MiddlewareContext } from '@elysia-ravel/core'
import { User } from '../models/User'

/**
 * UserController — a RESTful resource controller. Wired up in `routes/api.ts`
 * with `resource('/users', UserController)`. Passwords stay hidden by the model.
 */
export class UserController extends Controller {
  /** GET /users */
  async index() {
    return (await User.all()).toArray()
  }

  /** GET /users/:id */
  async show(ctx: MiddlewareContext) {
    const user = await User.find(Number(ctx.params.id))
    return user ? user.toJSON() : ctx.status(404, { message: 'User not found' })
  }

  /** POST /users */
  async store(ctx: MiddlewareContext) {
    const user = await User.create(ctx.body as Record<string, unknown>)
    return ctx.status(201, user.toJSON())
  }

  /** DELETE /users/:id */
  async destroy(ctx: MiddlewareContext) {
    const user = await User.find(Number(ctx.params.id))
    if (!user) return ctx.status(404, { message: 'User not found' })
    await user.delete()
    return { deleted: true }
  }
}

export default UserController
