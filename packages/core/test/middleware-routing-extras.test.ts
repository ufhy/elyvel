import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import {
  Middleware,
  type MiddlewareContext,
  registerMiddlewareRegistry,
  route,
} from '../src/middleware'
import { Controller, resource } from '../src/routing'

describe('middleware terminate (after phase)', () => {
  test('runs after the response is sent', async () => {
    const order: string[] = []
    class Timing extends Middleware {
      handle() {
        order.push('before')
      }
      override terminate() {
        order.push('after')
      }
    }
    registerMiddlewareRegistry({ aliases: { timing: Timing } })
    const app = new Elysia().use(
      route().get(
        '/x',
        () => {
          order.push('handler')
          return 'ok'
        },
        { middleware: 'timing' },
      ),
    )
    const res = await app.handle(new Request('http://localhost/x'))
    await res.text()
    await new Promise((r) => setTimeout(r, 5)) // let afterResponse flush
    expect(order).toEqual(['before', 'handler', 'after'])
  })
})

describe('route({ middleware }) group bundling', () => {
  test('applies middleware to every route in the group', async () => {
    class Block extends Middleware {
      handle(ctx: MiddlewareContext) {
        if (!ctx.request.headers.get('x-key')) return ctx.status(401, { message: 'no' })
      }
    }
    registerMiddlewareRegistry({ aliases: { key: Block } })
    const app = new Elysia().use(
      route('/admin', { middleware: ['key'] })
        .get('/a', () => 'a')
        .get('/b', () => 'b'),
    )
    expect((await app.handle(new Request('http://localhost/admin/a'))).status).toBe(401)
    expect((await app.handle(new Request('http://localhost/admin/b'))).status).toBe(401)
    const ok = await app.handle(
      new Request('http://localhost/admin/a', { headers: { 'x-key': '1' } }),
    )
    expect(await ok.text()).toBe('a')
  })
})

describe('resource route model binding', () => {
  const store = new Map<number, { id: number; name: string }>([
    [1, { id: 1, name: 'Ada' }],
    [2, { id: 2, name: 'Alan' }],
  ])
  const UserModel = { find: (id: unknown) => store.get(Number(id)) ?? null }

  class UserController extends Controller {
    async show(ctx: MiddlewareContext) {
      return ctx.model // injected by binding
    }
    async destroy(ctx: MiddlewareContext) {
      const user = ctx.model as { id: number }
      return { deletedId: user.id }
    }
  }

  registerMiddlewareRegistry({ aliases: {} })
  const app = new Elysia().use(resource('/users', UserController, { bind: UserModel }))

  test('resolves the model and injects ctx.model', async () => {
    const res = await app.handle(new Request('http://localhost/users/1'))
    expect(await res.json()).toEqual({ id: 1, name: 'Ada' })
  })

  test('404 when the model is not found', async () => {
    const res = await app.handle(new Request('http://localhost/users/999'))
    expect(res.status).toBe(404)
  })

  test('binding also applies to destroy', async () => {
    const res = await app.handle(new Request('http://localhost/users/2', { method: 'DELETE' }))
    expect(await res.json()).toEqual({ deletedId: 2 })
  })
})
