import type { MiddlewareContext } from '../src/middleware'
import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { registerMiddlewareRegistry } from '../src/middleware'
import { Controller, resource } from '../src/routing'

class CommentController extends Controller {
  async show(ctx: MiddlewareContext) {
    return ctx.model
  }
}

describe('scoped nested bindings', () => {
  registerMiddlewareRegistry({ aliases: {} })

  const comments = new Map([
    [5, { id: 5, photo_id: 1, body: 'nice' }],
    [6, { id: 6, photo_id: 2, body: 'also nice' }],
  ])
  const CommentModel = { find: (id: unknown) => comments.get(Number(id)) ?? null }

  const app = new Elysia().use(
    resource('/photos/:photo/comments', CommentController, {
      only: ['show'],
      param: 'id',
      bind: CommentModel,
      scoped: { photo: 'photo_id' },
    }),
  )

  test('resolves when the child truly belongs to the parent', async () => {
    const res = await app.handle(new Request('http://localhost/photos/1/comments/5'))
    expect(await res.json()).toEqual({ id: 5, photo_id: 1, body: 'nice' })
  })

  test('404s when the child exists but belongs to a DIFFERENT parent', async () => {
    // comment 6 belongs to photo 2, not photo 1 — must not leak through
    const res = await app.handle(new Request('http://localhost/photos/1/comments/6'))
    expect(res.status).toBe(404)
  })

  test('still 404s for a genuinely nonexistent child', async () => {
    const res = await app.handle(new Request('http://localhost/photos/1/comments/999'))
    expect(res.status).toBe(404)
  })

  test('a custom onMissing still fires for a scope mismatch, not just a true 404', async () => {
    let missingCalled = false
    const scopedApp = new Elysia().use(
      resource('/photos/:photo/comments', CommentController, {
        only: ['show'],
        param: 'id',
        bind: CommentModel,
        scoped: { photo: 'photo_id' },
        onMissing: (ctx) => {
          missingCalled = true
          return ctx.status(404, { message: 'custom missing' })
        },
      }),
    )
    const res = await scopedApp.handle(new Request('http://localhost/photos/1/comments/6'))
    expect(missingCalled).toBe(true)
    expect(await res.json()).toEqual({ message: 'custom missing' })
  })
})
