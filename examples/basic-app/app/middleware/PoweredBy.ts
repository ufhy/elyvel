import type { MiddlewareContext } from '@elysia-ravel/core'
import { Middleware } from '@elysia-ravel/core'

/** Adds an `X-Powered-By` header to every response (registered as global). */
export class PoweredBy extends Middleware {
  handle(ctx: MiddlewareContext) {
    ctx.set.headers['x-powered-by'] = 'elysia-ravel'
  }
}

export default PoweredBy
