import { Controller, type MiddlewareContext } from '@elysia-ravel/core'
import { Hash } from '@elysia-ravel/auth'
import { User } from '../models/User'
import { StoreUserRequest } from '../requests/StoreUserRequest'

/**
 * UserController — a RESTful resource controller. Wired up in `routes/api.ts`
 * with `resource('/users', UserController)`. Passwords stay hidden by the model.
 */
export class UserController extends Controller {
  /** GET /users */
  async index() {
    return (await User.all()).toArray()
  }

  /** GET /users/:id — `ctx.model` is resolved by route model binding (404 if missing). */
  async show(ctx: MiddlewareContext) {
    return (ctx.model as User).toJSON()
  }

  /** POST /users — validated by StoreUserRequest (422 Laravel bag on failure). */
  async store(ctx: MiddlewareContext) {
    const data = await StoreUserRequest.validate(ctx)
    const user = await User.create({
      name: data.name,
      email: data.email,
      password: await Hash.make(String(data.password)),
    })
    return ctx.status(201, user.toJSON())
  }

  /** DELETE /users/:id — bound model, already 404-guarded. */
  async destroy(ctx: MiddlewareContext) {
    await (ctx.model as User).delete()
    return { deleted: true }
  }
}

export default UserController
