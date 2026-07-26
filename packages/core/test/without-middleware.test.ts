import type { MiddlewareContext } from '../src/middleware'
import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { Middleware, registerMiddlewareRegistry } from '../src/middleware'
import { Controller, resource, UseMiddleware, WithoutMiddleware } from '../src/routing'

describe('@WithoutMiddleware', () => {
  test('excludes a class-level middleware from one method only', async () => {
    const order: string[] = []
    class Auth extends Middleware {
      handle() { order.push('auth') }
    }
    class Subscribed extends Middleware {
      handle() { order.push('subscribed') }
    }
    registerMiddlewareRegistry({ aliases: { auth: Auth, subscribed: Subscribed } })

    @UseMiddleware('auth', 'subscribed')
    class PostController extends Controller {
      async index() {
        order.push('index-handler')
        return 'list'
      }

      @WithoutMiddleware('subscribed')
      async store() {
        order.push('store-handler')
        return 'created'
      }
    }

    const app = new Elysia().use(resource('/posts', PostController, { only: ['index', 'store'] }))

    order.length = 0
    await app.handle(new Request('http://localhost/posts'))
    expect(order).toEqual(['auth', 'subscribed', 'index-handler'])

    order.length = 0
    await app.handle(new Request('http://localhost/posts', { method: 'POST' }))
    expect(order).toEqual(['auth', 'store-handler'])
  })

  test('a class-level @WithoutMiddleware excludes from every action', async () => {
    const order: string[] = []
    class Block extends Middleware {
      handle(ctx: MiddlewareContext) {
        if (!ctx.request.headers.get('x-key'))
          return ctx.status(401)
      }
    }
    registerMiddlewareRegistry({ aliases: { block: Block } })

    @UseMiddleware('block')
    @WithoutMiddleware('block')
    class OpenController extends Controller {
      async index() {
        order.push('ran')
        return 'list'
      }
    }

    const app = new Elysia().use(resource('/open', OpenController, { only: ['index'] }))
    // no x-key header — would 401 if 'block' were still active
    const res = await app.handle(new Request('http://localhost/open'))
    expect(res.status).toBe(200)
    expect(order).toEqual(['ran'])
  })

  test('excluding a middleware the action never had is a harmless no-op', async () => {
    class Noop extends Controller {
      @WithoutMiddleware('nonexistent')
      async index() {
        return 'ok'
      }
    }
    registerMiddlewareRegistry({ aliases: {} })
    const app = new Elysia().use(resource('/noop', Noop, { only: ['index'] }))
    const res = await app.handle(new Request('http://localhost/noop'))
    expect(res.status).toBe(200)
  })
})
