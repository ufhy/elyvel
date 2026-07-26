import type { MiddlewareContext } from '../src/middleware'
import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { Middleware, registerMiddlewareRegistry } from '../src/middleware'
import { Authorize, Controller, resource, UseMiddleware } from '../src/routing'

describe('@UseMiddleware', () => {
  test('on a method applies only to that action', async () => {
    class Block extends Middleware {
      handle(ctx: MiddlewareContext) {
        if (!ctx.request.headers.get('x-key'))
          return ctx.status(401, { message: 'blocked' })
      }
    }
    registerMiddlewareRegistry({ aliases: { key: Block } })

    class PostController extends Controller {
      async index() {
        return 'list'
      }

      @UseMiddleware('key')
      async store() {
        return 'created'
      }
    }

    const app = new Elysia().use(resource('/posts', PostController, { only: ['index', 'store'] }))

    // index has no @UseMiddleware — unaffected
    expect((await app.handle(new Request('http://localhost/posts'))).status).toBe(200)

    // store is guarded
    expect((await app.handle(new Request('http://localhost/posts', { method: 'POST' }))).status).toBe(401)
    const ok = await app.handle(
      new Request('http://localhost/posts', { method: 'POST', headers: { 'x-key': '1' } }),
    )
    expect(ok.status).toBe(200)
  })

  test('on the class applies to every action, merged with a method-level one', async () => {
    const order: string[] = []
    class First extends Middleware {
      handle() {
        order.push('first')
      }
    }
    class Second extends Middleware {
      handle() {
        order.push('second')
      }
    }
    registerMiddlewareRegistry({ aliases: { first: First, second: Second } })

    @UseMiddleware('first')
    class NoteController extends Controller {
      async index() {
        order.push('index-handler')
        return 'list'
      }

      @UseMiddleware('second')
      async store() {
        order.push('store-handler')
        return 'created'
      }
    }

    const app = new Elysia().use(resource('/notes', NoteController, { only: ['index', 'store'] }))

    order.length = 0
    await app.handle(new Request('http://localhost/notes'))
    expect(order).toEqual(['first', 'index-handler'])

    order.length = 0
    await app.handle(new Request('http://localhost/notes', { method: 'POST' }))
    expect(order).toEqual(['first', 'second', 'store-handler'])
  })

  test('merges with an explicit resource({ middleware }) option (class, then method, then option)', async () => {
    const order: string[] = []
    class A extends Middleware {
      handle() {
        order.push('a')
      }
    }
    class B extends Middleware {
      handle() {
        order.push('b')
      }
    }
    class C extends Middleware {
      handle() {
        order.push('c')
      }
    }
    registerMiddlewareRegistry({ aliases: { a: A, b: B, c: C } })

    @UseMiddleware('a')
    class ThingController extends Controller {
      @UseMiddleware('b')
      async index() {
        return 'list'
      }
    }

    const app = new Elysia().use(
      resource('/things', ThingController, { only: ['index'], middleware: ['c'] }),
    )
    await app.handle(new Request('http://localhost/things'))
    expect(order).toEqual(['a', 'b', 'c'])
  })
})

describe('@Authorize', () => {
  test('calls ctx.authorize(ability, ctx.model) before the action, after model binding', async () => {
    const calls: { ability: string, model: unknown }[] = []
    const store = new Map([[1, { id: 1, title: 'A' }]])
    const PostModel = { find: (id: unknown) => store.get(Number(id)) ?? null }

    class PostController extends Controller {
      @Authorize('update')
      async update(ctx: MiddlewareContext) {
        return { updated: ctx.model }
      }
    }

    const app = new Elysia()
      .onBeforeHandle((ctx: any) => {
        ctx.authorize = (ability: string, model: unknown) => {
          calls.push({ ability, model })
        }
      })
      .use(resource('/posts', PostController, { only: ['update'], bind: PostModel }))

    const res = await app.handle(new Request('http://localhost/posts/1', { method: 'PUT' }))
    expect(await res.json()).toEqual({ updated: { id: 1, title: 'A' } })
    expect(calls).toEqual([{ ability: 'update', model: { id: 1, title: 'A' } }])
  })

  test('a throwing ctx.authorize blocks the action from running', async () => {
    class PostController extends Controller {
      @Authorize('delete')
      async destroy() {
        return { deleted: true }
      }
    }

    const app = new Elysia()
      .onBeforeHandle((ctx: any) => {
        ctx.authorize = () => {
          throw new Error('denied')
        }
      })
      .use(resource('/posts', PostController, { only: ['destroy'] }))

    // Elysia turns a thrown error into an error response rather than a rejected
    // promise — the important thing is the action body never ran.
    const res = await app.handle(new Request('http://localhost/posts/1', { method: 'DELETE' }))
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  test('an action with no @Authorize never touches ctx.authorize', async () => {
    let touched = false
    class PostController extends Controller {
      async index() {
        return 'list'
      }
    }
    const app = new Elysia()
      .onBeforeHandle((ctx: any) => {
        ctx.authorize = () => {
          touched = true
        }
      })
      .use(resource('/posts', PostController, { only: ['index'] }))

    await app.handle(new Request('http://localhost/posts'))
    expect(touched).toBe(false)
  })
})
