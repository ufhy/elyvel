import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { registerMiddlewareRegistry } from '../src/middleware'
import { authorizeResource, Controller, resource } from '../src/routing'

registerMiddlewareRegistry({ aliases: {} })

class Post {
  constructor(public id: string) {}
}

/**
 * Regression: `bindAction` only set `ctx.model` for show/edit/update/destroy, so
 * the collection actions called `authorize('viewAny', undefined)` /
 * `authorize('create', undefined)`. Gate resolves a policy from `args[0]`, so
 * with no target no policy matched: the check fell through to the named-ability
 * map, missed, and DENIED — making `authorizeResource(PostController)` +
 * `resource('/posts', PostController, { bind: Post })` return a permanent 403
 * for `index`, `create` and `store`, which is the flow the docs recommend.
 * Worse, an unrelated global `define('create', …)` was consulted instead of the
 * model's policy.
 */
describe('collection actions authorize against the model class', () => {
  test('index/create/store receive the model class as the target', async () => {
    const targets: { ability: string, target: unknown }[] = []

    class PostController extends Controller {
      async index(): Promise<string> {
        return 'index'
      }

      async create(): Promise<string> {
        return 'create'
      }

      async store(): Promise<string> {
        return 'store'
      }
    }
    authorizeResource(PostController)

    const app = new Elysia()
      .onBeforeHandle((ctx: any) => {
        ctx.authorize = (ability: string, target: unknown) => {
          targets.push({ ability, target })
        }
      })
      .use(resource('/posts', PostController, { bind: Post as any }))

    await app.handle(new Request('http://localhost/posts'))
    await app.handle(new Request('http://localhost/posts/create'))
    await app.handle(new Request('http://localhost/posts', { method: 'POST' }))

    expect(targets.map(t => t.ability)).toEqual(['viewAny', 'create', 'create'])
    // The class itself, which is what Gate needs to find the policy.
    for (const t of targets)
      expect(t.target).toBe(Post)
  })

  test('member actions still receive the resolved instance, not the class', async () => {
    const targets: unknown[] = []

    class PostController extends Controller {
      async show(): Promise<string> {
        return 'show'
      }
    }
    authorizeResource(PostController)

    const app = new Elysia()
      .onBeforeHandle((ctx: any) => {
        ctx.authorize = (_ability: string, target: unknown) => {
          targets.push(target)
        }
      })
      .use(resource('/posts', PostController, {
        bind: { find: async (id: string) => new Post(id) } as any,
      }))

    await app.handle(new Request('http://localhost/posts/1'))

    expect(targets).toHaveLength(1)
    expect(targets[0]).toBeInstanceOf(Post)
  })

  test('with no bind configured the target stays undefined (unchanged)', async () => {
    const targets: unknown[] = []

    class PostController extends Controller {
      async index(): Promise<string> {
        return 'index'
      }
    }
    authorizeResource(PostController)

    const app = new Elysia()
      .onBeforeHandle((ctx: any) => {
        ctx.authorize = (_ability: string, target: unknown) => {
          targets.push(target)
        }
      })
      .use(resource('/posts', PostController))

    await app.handle(new Request('http://localhost/posts'))
    expect(targets).toEqual([undefined])
  })
})
