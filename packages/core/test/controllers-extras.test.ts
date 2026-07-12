import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { type MiddlewareContext, registerMiddlewareRegistry } from '../src/middleware'
import { Controller, invoke, resource, singleton } from '../src/routing'

registerMiddlewareRegistry({ aliases: {} })

describe('singleton resource', () => {
  class ProfileController extends Controller {
    async show() {
      return { name: 'Ada' }
    }
    async update(ctx: MiddlewareContext) {
      return { updated: ctx.body }
    }
    async destroy() {
      return { deleted: true }
    }
  }
  const app = new Elysia().use(singleton('/profile', ProfileController))
  const json = { 'content-type': 'application/json' }

  test('show/update/destroy without :id', async () => {
    expect(await (await app.handle(new Request('http://localhost/profile'))).json()).toEqual({
      name: 'Ada',
    })
    const upd = await app.handle(
      new Request('http://localhost/profile', { method: 'PUT', headers: json, body: '{"x":1}' }),
    )
    expect(await upd.json()).toEqual({ updated: { x: 1 } })
    const del = await app.handle(new Request('http://localhost/profile', { method: 'DELETE' }))
    expect(await del.json()).toEqual({ deleted: true })
  })

  test('no store route unless creatable', async () => {
    const res = await app.handle(
      new Request('http://localhost/profile', { method: 'POST', headers: json, body: '{}' }),
    )
    expect(res.status).not.toBe(200)
  })

  test('creatable adds a store route', async () => {
    class Creatable extends Controller {
      async store() {
        return { created: true }
      }
    }
    const app2 = new Elysia().use(singleton('/setup', Creatable, { creatable: true }))
    const res = await app2.handle(
      new Request('http://localhost/setup', { method: 'POST', headers: json, body: '{}' }),
    )
    expect(await res.json()).toEqual({ created: true })
  })
})

describe('invokable controller', () => {
  test('invoke() wires a single-action controller', async () => {
    class ProvisionServer extends Controller {
      handle(ctx: MiddlewareContext) {
        return ctx.status(202, { queued: true })
      }
    }
    const app = new Elysia().post('/provision', invoke(ProvisionServer))
    const res = await app.handle(new Request('http://localhost/provision', { method: 'POST' }))
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ queued: true })
  })

  test('throws if no handle/__invoke', () => {
    class Empty extends Controller {}
    expect(() => invoke(Empty as never)).toThrow(/handle\(\) or __invoke/)
  })
})

describe('resource onMissing', () => {
  test('custom handler runs instead of default 404', async () => {
    const binder = { find: () => null }
    class C extends Controller {
      async show(ctx: MiddlewareContext) {
        return ctx.model
      }
    }
    const app = new Elysia().use(
      resource('/things', C, {
        bind: binder,
        onMissing: (ctx) => ctx.status(410, { gone: true }),
      }),
    )
    const res = await app.handle(new Request('http://localhost/things/1'))
    expect(res.status).toBe(410)
    expect(await res.json()).toEqual({ gone: true })
  })
})
