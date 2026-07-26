import type { MiddlewareContext } from '../src/middleware'
import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { registerMiddlewareRegistry } from '../src/middleware'
import { Controller, resource, ValidateWith } from '../src/routing'

registerMiddlewareRegistry({ aliases: {} })

// A duck-typed stand-in for `@elyvel/validation`'s FormRequest (core can't
// depend on validation — this proves the decoupling contract actually works).
class StorePostRequest {
  static async validate(ctx: MiddlewareContext) {
    const body = ctx.body as Record<string, unknown>
    if (!body?.title)
      throw Object.assign(new Error('The title field is required.'), { status: 422 })
    return { title: body.title }
  }
}

class PostController extends Controller {
  @ValidateWith(StorePostRequest)
  async store(ctx: MiddlewareContext) {
    return { validated: ctx.validated }
  }
}

const json = { 'content-type': 'application/json' }

describe('@ValidateWith', () => {
  test('exposes the FormRequest\'s validated data as ctx.validated', async () => {
    const app = new Elysia().use(resource('/posts', PostController, { only: ['store'] }))
    const res = await app.handle(
      new Request('http://localhost/posts', { method: 'POST', headers: json, body: JSON.stringify({ title: 'Hello' }) }),
    )
    expect(await res.json()).toEqual({ validated: { title: 'Hello' } })
  })

  test('a validation failure throws before the action body ever runs', async () => {
    let ran = false
    class Strict extends Controller {
      @ValidateWith(StorePostRequest)
      async store(ctx: MiddlewareContext) {
        ran = true
        return ctx.validated
      }
    }
    const app = new Elysia().use(resource('/strict', Strict, { only: ['store'] }))
    const res = await app.handle(
      new Request('http://localhost/strict', { method: 'POST', headers: json, body: '{}' }),
    )
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(ran).toBe(false)
  })

  test('an action with no @ValidateWith never touches ctx.validated', async () => {
    class Plain extends Controller {
      async index(ctx: MiddlewareContext) {
        return { validated: ctx.validated }
      }
    }
    const app = new Elysia().use(resource('/plain', Plain, { only: ['index'] }))
    const res = await app.handle(new Request('http://localhost/plain'))
    expect(await res.json()).toEqual({ validated: undefined })
  })
})
