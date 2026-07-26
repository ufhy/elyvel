import type { MiddlewareContext } from '../src/middleware'
import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { Middleware, registerMiddlewareRegistry } from '../src/middleware'
import { Controller, resource } from '../src/routing'

describe('fluent .middlewareFor() / .withoutMiddlewareFor()', () => {
  test('middlewareFor() adds a guard to one action only, applied AFTER resource() returns', async () => {
    let blocked = 0
    class Guard extends Middleware {
      handle(ctx: MiddlewareContext) {
        if (!ctx.request.headers.get('x-key')) {
          blocked++
          return ctx.status(401)
        }
      }
    }
    registerMiddlewareRegistry({ aliases: { guard: Guard } })

    class PostController extends Controller {
      async index() { return 'list' }
      async store() { return 'created' }
    }

    const app = new Elysia().use(
      resource('/posts', PostController, { only: ['index', 'store'] }).middlewareFor('store', 'guard'),
    )

    // index untouched
    expect((await app.handle(new Request('http://localhost/posts'))).status).toBe(200)
    // store now guarded
    expect((await app.handle(new Request('http://localhost/posts', { method: 'POST' }))).status).toBe(401)
    expect(blocked).toBe(1)
    const ok = await app.handle(
      new Request('http://localhost/posts', { method: 'POST', headers: { 'x-key': '1' } }),
    )
    expect(ok.status).toBe(200)
  })

  test('withoutMiddlewareFor() removes a guard from one action, applied AFTER resource() returns', async () => {
    class Guard extends Middleware {
      handle(ctx: MiddlewareContext) {
        if (!ctx.request.headers.get('x-key'))
          return ctx.status(401)
      }
    }
    registerMiddlewareRegistry({ aliases: { guard: Guard } })

    class PostController extends Controller {
      async index() { return 'list' }
      async store() { return 'created' }
    }

    const route = resource('/posts', PostController, {
      only: ['index', 'store'],
      middleware: ['guard'],
    })
    route.withoutMiddlewareFor('index', 'guard')
    const app = new Elysia().use(route)

    // index no longer guarded
    expect((await app.handle(new Request('http://localhost/posts'))).status).toBe(200)
    // store still guarded
    expect((await app.handle(new Request('http://localhost/posts', { method: 'POST' }))).status).toBe(401)
  })

  test('middleware() adds a guard to EVERY action', async () => {
    let count = 0
    class Counter extends Middleware {
      handle() { count++ }
    }
    registerMiddlewareRegistry({ aliases: { counter: Counter } })

    class PostController extends Controller {
      async index() { return 'list' }
      async store() { return 'created' }
    }
    const app = new Elysia().use(
      resource('/posts', PostController, { only: ['index', 'store'] }).middleware('counter'),
    )
    await app.handle(new Request('http://localhost/posts'))
    await app.handle(new Request('http://localhost/posts', { method: 'POST' }))
    expect(count).toBe(2)
  })
})
