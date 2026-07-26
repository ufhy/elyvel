import type { MiddlewareContext } from '../src/middleware'
import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { registerMiddlewareRegistry } from '../src/middleware'
import { Controller, resource } from '../src/routing'

class PhotoController extends Controller {
  async show(ctx: MiddlewareContext) {
    return { photo: ctx.params.photo }
  }
}

class CommentController extends Controller {
  async index(ctx: MiddlewareContext) {
    return { photo: ctx.params.photo, list: true }
  }

  async store(ctx: MiddlewareContext) {
    return { photo: ctx.params.photo, created: true }
  }

  async show(ctx: MiddlewareContext) {
    return { id: ctx.params.id }
  }

  async update(ctx: MiddlewareContext) {
    return { id: ctx.params.id, updated: true }
  }

  async destroy(ctx: MiddlewareContext) {
    return { id: ctx.params.id, deleted: true }
  }
}

describe('shallow nesting', () => {
  registerMiddlewareRegistry({ aliases: {} })
  const app = new Elysia()
    .use(resource('/photos', PhotoController, { only: ['show'], param: 'photo' }))
    .use(
      resource('/photos/:photo/comments', CommentController, {
        shallow: true,
        param: 'id',
      }),
    )

  test('collection actions (index/store) stay nested under the parent', async () => {
    const idx = await app.handle(new Request('http://localhost/photos/1/comments'))
    expect(await idx.json()).toEqual({ photo: '1', list: true })

    const created = await app.handle(new Request('http://localhost/photos/1/comments', { method: 'POST' }))
    expect(await created.json()).toEqual({ photo: '1', created: true })
  })

  test('member actions (show/update/destroy) move to a flat top-level path', async () => {
    const shown = await app.handle(new Request('http://localhost/comments/5'))
    expect(await shown.json()).toEqual({ id: '5' })

    // must NOT still be reachable at the nested path
    const nested = await app.handle(new Request('http://localhost/photos/1/comments/5'))
    expect(nested.status).toBe(404)

    const updated = await app.handle(new Request('http://localhost/comments/5', { method: 'PUT' }))
    expect(await updated.json()).toEqual({ id: '5', updated: true })

    const destroyed = await app.handle(new Request('http://localhost/comments/5', { method: 'DELETE' }))
    expect(await destroyed.json()).toEqual({ id: '5', deleted: true })
  })

  test('the parent resource itself still works (no regression from composing a shallow child)', async () => {
    const res = await app.handle(new Request('http://localhost/photos/9'))
    expect(await res.json()).toEqual({ photo: '9' })
  })
})
