import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { registerMiddlewareRegistry } from '../src/middleware'
import { apiResources, Controller, resources } from '../src/routing'

registerMiddlewareRegistry({ aliases: {} })

class PhotoController extends Controller {
  async index() { return 'photos' }
  async create() { return 'photo-form' }
}
class PostController extends Controller {
  async index() { return 'posts' }
  async create() { return 'post-form' }
}

describe('resources() batch registration', () => {
  test('registers every controller in the map, full 7-action shape', async () => {
    const app = new Elysia().use(
      resources({ photos: PhotoController, posts: PostController }, { only: ['index', 'create'] }),
    )
    expect(await (await app.handle(new Request('http://localhost/photos'))).text()).toBe('photos')
    expect(await (await app.handle(new Request('http://localhost/posts'))).text()).toBe('posts')
    expect(await (await app.handle(new Request('http://localhost/photos/create'))).text()).toBe('photo-form')
  })
})

describe('apiResources() batch registration', () => {
  test('registers every controller, JSON-only shape (no /create)', async () => {
    const app = new Elysia().use(apiResources({ photos: PhotoController, posts: PostController }))
    expect(await (await app.handle(new Request('http://localhost/photos'))).text()).toBe('photos')
    expect(await (await app.handle(new Request('http://localhost/posts'))).text()).toBe('posts')
    expect((await app.handle(new Request('http://localhost/photos/create'))).status).toBe(404)
  })
})
