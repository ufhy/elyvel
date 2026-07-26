import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { registerMiddlewareRegistry } from '../src/middleware'
import { Authorize, authorizeResource, Controller, resource } from '../src/routing'

registerMiddlewareRegistry({ aliases: {} })

describe('authorizeResource', () => {
  test('maps every defined action to its conventional ability', async () => {
    const calls: string[] = []

    class PostController extends Controller {
      async index() { return 'index' }
      async show() { return 'show' }
      async create() { return 'create' }
      async store() { return 'store' }
      async edit() { return 'edit' }
      async update() { return 'update' }
      async destroy() { return 'destroy' }
    }
    authorizeResource(PostController)

    const app = new Elysia()
      .onBeforeHandle((ctx: any) => {
        ctx.authorize = (ability: string) => calls.push(ability)
      })
      .use(resource('/posts', PostController))

    await app.handle(new Request('http://localhost/posts'))
    await app.handle(new Request('http://localhost/posts/1'))
    await app.handle(new Request('http://localhost/posts/create'))
    await app.handle(new Request('http://localhost/posts', { method: 'POST' }))
    await app.handle(new Request('http://localhost/posts/1/edit'))
    await app.handle(new Request('http://localhost/posts/1', { method: 'PUT' }))
    await app.handle(new Request('http://localhost/posts/1', { method: 'DELETE' }))

    expect(calls).toEqual(['viewAny', 'view', 'create', 'create', 'update', 'update', 'delete'])
  })

  test('an explicit @Authorize on one method overrides the conventional mapping', async () => {
    const calls: string[] = []

    class CommentController extends Controller {
      async index() { return 'index' }

      @Authorize('moderate')
      async destroy() { return 'destroy' }
    }
    authorizeResource(CommentController)

    const app = new Elysia()
      .onBeforeHandle((ctx: any) => {
        ctx.authorize = (ability: string) => calls.push(ability)
      })
      .use(resource('/comments', CommentController, { only: ['index', 'destroy'] }))

    await app.handle(new Request('http://localhost/comments'))
    await app.handle(new Request('http://localhost/comments/1', { method: 'DELETE' }))

    // destroy kept its explicit 'moderate', NOT the conventional 'delete'
    expect(calls).toEqual(['viewAny', 'moderate'])
  })

  test('an action the controller never defines is simply skipped, not authorized against nothing', async () => {
    class ReadOnlyController extends Controller {
      async index() { return 'index' }
      async show() { return 'show' }
    }
    // Should not throw even though create/store/edit/update/destroy don't exist.
    expect(() => authorizeResource(ReadOnlyController)).not.toThrow()
  })
})
