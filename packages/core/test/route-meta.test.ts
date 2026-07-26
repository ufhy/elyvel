import { describe, expect, test } from 'bun:test'
import { registerMiddlewareRegistry } from '../src/middleware'
import { Authorize, authorizeResource, Controller, resource, routeMetaEntries, UseMiddleware } from '../src/routing'

registerMiddlewareRegistry({ aliases: {} })

describe('routeMetaEntries', () => {
  test('records method/path/middleware/authorize for every resource action', () => {
    const before = routeMetaEntries().length

    @UseMiddleware('auth')
    class PostController extends Controller {
      async index() { return [] }
      async show() { return {} }

      @Authorize('delete')
      async destroy() { return {} }
    }
    authorizeResource(PostController)

    resource('/route-meta-posts', PostController, { only: ['index', 'show', 'destroy'] })

    const entries = routeMetaEntries().slice(before)
    const byPath = new Map(entries.map(e => [`${e.method} ${e.path}`, e]))

    expect(byPath.get('GET /route-meta-posts')).toEqual({
      method: 'GET',
      path: '/route-meta-posts',
      middleware: ['auth'],
      authorize: 'viewAny',
    })
    expect(byPath.get('GET /route-meta-posts/:id')).toEqual({
      method: 'GET',
      path: '/route-meta-posts/:id',
      middleware: ['auth'],
      authorize: 'view',
    })
    // explicit @Authorize('delete') overrides the conventional 'delete' — same
    // value here, but confirms it came from the override path, not a guess
    expect(byPath.get('DELETE /route-meta-posts/:id')).toEqual({
      method: 'DELETE',
      path: '/route-meta-posts/:id',
      middleware: ['auth'],
      authorize: 'delete',
    })
  })

  test('update registers BOTH a PUT and a PATCH entry', () => {
    const before = routeMetaEntries().length
    class ThingController extends Controller {
      async update() { return {} }
    }
    resource('/route-meta-things', ThingController, { only: ['update'] })
    const entries = routeMetaEntries().slice(before)
    expect(entries.map(e => e.method).sort()).toEqual(['PATCH', 'PUT'])
  })
})
