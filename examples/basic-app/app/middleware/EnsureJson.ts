import type { MiddlewareContext } from '@elysia-ravel/core'
import { Middleware } from '@elysia-ravel/core'

/**
 * Require a JSON body on writes. Registered as the `json` alias — apply with
 * `{ middleware: 'json' }` on a route.
 */
export class EnsureJson extends Middleware {
  handle(ctx: MiddlewareContext) {
    const method = ctx.request.method
    if (method === 'GET' || method === 'HEAD')
      return
    const type = ctx.request.headers.get('content-type') ?? ''
    if (!type.includes('application/json')) {
      return ctx.status(415, { message: 'Content-Type must be application/json' })
    }
  }
}

export default EnsureJson
