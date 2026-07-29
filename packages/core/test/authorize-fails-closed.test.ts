import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { registerMiddlewareRegistry } from '../src/middleware'
import { Authorize, authorizeResource, Controller, resource } from '../src/routing'

registerMiddlewareRegistry({ aliases: {} })

/**
 * Regression: the ability check was an OPTIONAL call —
 * `(ctx.authorize as …| undefined)?.(ability, ctx.model)`. `ctx.authorize` is
 * injected by the auth plugin, so any route tree without it mounted (plain
 * `route()` instead of `webRoute()`, `@elyvel/auth` not installed, a test
 * harness, or a mount-ordering slip) ran the decorated action with NO
 * authorization at all and returned 200. It also wasn't awaited, so an async
 * authorizer became an unhandled rejection while the handler ran anyway.
 */
describe('@Authorize fails closed when no authorizer is on the context', () => {
  test('a decorated action does not run without an authorizer', async () => {
    let ran = false

    class PostController extends Controller {
      @Authorize('update')
      async update(): Promise<string> {
        ran = true
        return 'updated'
      }
    }

    const app = new Elysia().use(resource('/posts', PostController))
    const response = await app.handle(new Request('http://localhost/posts/1', { method: 'PUT' }))

    expect(ran).toBe(false)
    expect(response.status).not.toBe(200)
  })

  test('authorizeResource()-mapped actions also fail closed', async () => {
    let ran = false

    class PostController extends Controller {
      async index(): Promise<string> {
        ran = true
        return 'index'
      }
    }
    authorizeResource(PostController)

    const app = new Elysia().use(resource('/posts', PostController))
    const response = await app.handle(new Request('http://localhost/posts'))

    expect(ran).toBe(false)
    expect(response.status).not.toBe(200)
  })

  test('an async authorizer is awaited — a rejection blocks the action', async () => {
    let ran = false

    class PostController extends Controller {
      @Authorize('update')
      async update(): Promise<string> {
        ran = true
        return 'updated'
      }
    }

    const app = new Elysia()
      .onBeforeHandle((ctx: any) => {
        ctx.authorize = async () => {
          throw new Error('denied')
        }
      })
      .use(resource('/posts', PostController))

    const response = await app.handle(new Request('http://localhost/posts/1', { method: 'PUT' }))

    expect(ran).toBe(false)
    expect(response.status).not.toBe(200)
  })

  test('a permitting authorizer still lets the action through', async () => {
    const seen: string[] = []

    class PostController extends Controller {
      @Authorize('update')
      async update(): Promise<string> {
        return 'updated'
      }
    }

    const app = new Elysia()
      .onBeforeHandle((ctx: any) => {
        ctx.authorize = (ability: string) => {
          seen.push(ability)
        }
      })
      .use(resource('/posts', PostController))

    const response = await app.handle(new Request('http://localhost/posts/1', { method: 'PUT' }))

    expect(seen).toEqual(['update'])
    expect(await response.text()).toBe('updated')
  })
})
