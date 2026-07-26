import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { registerMiddlewareRegistry } from '../src/middleware'
import { Controller, resource } from '../src/routing'

registerMiddlewareRegistry({ aliases: {} })

class PostController extends Controller {
  async show(ctx: any) { return ctx.model }
  async update(ctx: any) { return ctx.model }
  async destroy(ctx: any) { return ctx.model }
}

// A binder distinguishing "live" rows from "trashed" ones, mirroring an
// Eloquent-style soft-delete model with find()/findWithTrashed() both defined.
function makeBinder() {
  const live = new Map([[1, { id: 1, title: 'live' }]])
  const trashed = new Map([[2, { id: 2, title: 'trashed' }]])
  return {
    find: (id: unknown) => live.get(Number(id)) ?? null,
    findWithTrashed: (id: unknown) => live.get(Number(id)) ?? trashed.get(Number(id)) ?? null,
  }
}

describe('resource({ withTrashed })', () => {
  test('true applies to show/update but NOT destroy (Laravel default)', async () => {
    const app = new Elysia().use(
      resource('/posts', PostController, { bind: makeBinder(), withTrashed: true }),
    )
    const shown = await app.handle(new Request('http://localhost/posts/2'))
    expect(await shown.json()).toEqual({ id: 2, title: 'trashed' })

    const updated = await app.handle(new Request('http://localhost/posts/2', { method: 'PUT' }))
    expect(await updated.json()).toEqual({ id: 2, title: 'trashed' })

    // destroy is excluded from the default — a trashed row still 404s there
    const destroyed = await app.handle(new Request('http://localhost/posts/2', { method: 'DELETE' }))
    expect(destroyed.status).toBe(404)
  })

  test('an explicit action array narrows which actions see trashed rows', async () => {
    const app = new Elysia().use(
      resource('/posts', PostController, { bind: makeBinder(), withTrashed: ['show'] }),
    )
    const shown = await app.handle(new Request('http://localhost/posts/2'))
    expect(await shown.json()).toEqual({ id: 2, title: 'trashed' })

    // update was NOT included in the array — trashed row 404s there
    const updated = await app.handle(new Request('http://localhost/posts/2', { method: 'PUT' }))
    expect(updated.status).toBe(404)
  })

  test('without withTrashed, a soft-deleted row 404s everywhere (current default behavior unchanged)', async () => {
    const app = new Elysia().use(resource('/posts', PostController, { bind: makeBinder() }))
    const res = await app.handle(new Request('http://localhost/posts/2'))
    expect(res.status).toBe(404)
  })

  test('a live row still resolves normally regardless of withTrashed', async () => {
    const app = new Elysia().use(
      resource('/posts', PostController, { bind: makeBinder(), withTrashed: true }),
    )
    const res = await app.handle(new Request('http://localhost/posts/1'))
    expect(await res.json()).toEqual({ id: 1, title: 'live' })
  })
})
