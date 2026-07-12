import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { type MiddlewareContext, registerMiddlewareRegistry } from '../src/middleware'
import { Controller, resource } from '../src/routing'

class PostController extends Controller {
  async index() {
    return [{ id: 1 }, { id: 2 }]
  }
  async show(ctx: MiddlewareContext) {
    return { id: Number(ctx.params.id) }
  }
  async store(ctx: MiddlewareContext) {
    return ctx.status(201, ctx.body)
  }
  async update(ctx: MiddlewareContext) {
    return { id: Number(ctx.params.id), updated: true }
  }
  async destroy() {
    return { deleted: true }
  }
}

// Only index + show → the others must NOT be routed.
class ReadOnlyController extends Controller {
  async index() {
    return 'list'
  }
  async show() {
    return 'one'
  }
}

const json = { 'content-type': 'application/json' }

describe('resource routing', () => {
  registerMiddlewareRegistry({ aliases: {} })
  const app = new Elysia()
    .use(resource('/posts', PostController))
    .use(resource('/articles', ReadOnlyController, { only: ['index', 'show'] }))

  test('maps REST verbs to controller methods', async () => {
    expect(await (await app.handle(new Request('http://localhost/posts'))).json()).toEqual([
      { id: 1 },
      { id: 2 },
    ])
    expect(await (await app.handle(new Request('http://localhost/posts/7'))).json()).toEqual({
      id: 7,
    })

    const created = await app.handle(
      new Request('http://localhost/posts', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ title: 'x' }),
      }),
    )
    expect(created.status).toBe(201)

    const patched = await app.handle(
      new Request('http://localhost/posts/3', { method: 'PATCH', headers: json, body: '{}' }),
    )
    expect(await patched.json()).toEqual({ id: 3, updated: true })

    const put = await app.handle(new Request('http://localhost/posts/3', { method: 'PUT', headers: json, body: '{}' }))
    expect(await put.json()).toEqual({ id: 3, updated: true })

    const deleted = await app.handle(new Request('http://localhost/posts/3', { method: 'DELETE' }))
    expect(await deleted.json()).toEqual({ deleted: true })
  })

  test('only wires the requested actions', async () => {
    expect((await app.handle(new Request('http://localhost/articles'))).status).toBe(200)
    // store not defined/allowed → 404 (or 405), never 201
    const post = await app.handle(
      new Request('http://localhost/articles', { method: 'POST', headers: json, body: '{}' }),
    )
    expect(post.status).not.toBe(201)
  })

  test('per-action middleware runs (via aliases)', async () => {
    let blocked = false
    class Block extends Controller {}
    registerMiddlewareRegistry({
      aliases: {
        block: class {
          handle(ctx: MiddlewareContext) {
            blocked = true
            return ctx.status(403, { message: 'no' })
          }
        },
      },
    })
    void Block
    const guarded = new Elysia().use(
      resource('/things', PostController, { middleware: { destroy: ['block'] } }),
    )
    const res = await guarded.handle(new Request('http://localhost/things/1', { method: 'DELETE' }))
    expect(res.status).toBe(403)
    expect(blocked).toBe(true)
    // non-guarded action still works
    expect((await guarded.handle(new Request('http://localhost/things'))).status).toBe(200)
  })
})
