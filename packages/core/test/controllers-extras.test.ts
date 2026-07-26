import type { MiddlewareContext } from '../src/middleware'
import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { registerMiddlewareRegistry } from '../src/middleware'
import { apiSingleton, Controller, invoke, resource, singleton } from '../src/routing'

registerMiddlewareRegistry({ aliases: {} })

describe('singleton resource', () => {
  class ProfileController extends Controller {
    async show() {
      return { name: 'Ada' }
    }

    async edit() {
      return { form: 'edit' }
    }

    async update(ctx: MiddlewareContext) {
      return { updated: ctx.body }
    }

    async create() {
      return { form: 'create' }
    }

    async store() {
      return { created: true }
    }

    async destroy() {
      return { deleted: true }
    }
  }
  const json = { 'content-type': 'application/json' }

  test('base singleton: show/edit/update — NOT create/store/destroy (Laravel parity)', async () => {
    const app = new Elysia().use(singleton('/profile', ProfileController))

    expect(await (await app.handle(new Request('http://localhost/profile'))).json()).toEqual({
      name: 'Ada',
    })
    expect(await (await app.handle(new Request('http://localhost/profile/edit'))).json()).toEqual({
      form: 'edit',
    })
    const upd = await app.handle(
      new Request('http://localhost/profile', { method: 'PUT', headers: json, body: '{"x":1}' }),
    )
    expect(await upd.json()).toEqual({ updated: { x: 1 } })

    expect((await app.handle(new Request('http://localhost/profile/create'))).status).toBe(404)
    expect(
      (await app.handle(new Request('http://localhost/profile', { method: 'POST', headers: json, body: '{}' }))).status,
    ).not.toBe(200)
    expect((await app.handle(new Request('http://localhost/profile', { method: 'DELETE' }))).status).not.toBe(200)
  })

  test('creatable() adds create/store/destroy', async () => {
    const app = new Elysia().use(singleton('/profile', ProfileController, { creatable: true }))

    expect(await (await app.handle(new Request('http://localhost/profile/create'))).json()).toEqual({
      form: 'create',
    })
    const stored = await app.handle(
      new Request('http://localhost/profile', { method: 'POST', headers: json, body: '{}' }),
    )
    expect(await stored.json()).toEqual({ created: true })
    const destroyed = await app.handle(new Request('http://localhost/profile', { method: 'DELETE' }))
    expect(await destroyed.json()).toEqual({ deleted: true })
  })

  test('destroyable() adds ONLY destroy, without create/store', async () => {
    const app = new Elysia().use(singleton('/profile', ProfileController, { destroyable: true }))

    const destroyed = await app.handle(new Request('http://localhost/profile', { method: 'DELETE' }))
    expect(await destroyed.json()).toEqual({ deleted: true })
    expect((await app.handle(new Request('http://localhost/profile/create'))).status).toBe(404)
    expect(
      (await app.handle(new Request('http://localhost/profile', { method: 'POST', headers: json, body: '{}' }))).status,
    ).not.toBe(200)
  })

  test('apiSingleton: show/update only — no create/edit form routes', async () => {
    const app = new Elysia().use(apiSingleton('/profile', ProfileController))

    expect(await (await app.handle(new Request('http://localhost/profile'))).json()).toEqual({ name: 'Ada' })
    expect((await app.handle(new Request('http://localhost/profile/edit'))).status).toBe(404)
    expect((await app.handle(new Request('http://localhost/profile/create'))).status).toBe(404)
  })

  test('apiSingleton + creatable() adds store/destroy but still no create/edit forms', async () => {
    const app = new Elysia().use(apiSingleton('/profile', ProfileController, { creatable: true }))

    const stored = await app.handle(
      new Request('http://localhost/profile', { method: 'POST', headers: json, body: '{}' }),
    )
    expect(await stored.json()).toEqual({ created: true })
    expect((await app.handle(new Request('http://localhost/profile/create'))).status).toBe(404)
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
        onMissing: ctx => ctx.status(410, { gone: true }),
      }),
    )
    const res = await app.handle(new Request('http://localhost/things/1'))
    expect(res.status).toBe(410)
    expect(await res.json()).toEqual({ gone: true })
  })
})
