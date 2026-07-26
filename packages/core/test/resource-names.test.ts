import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { registerMiddlewareRegistry } from '../src/middleware'
import { Controller, resource } from '../src/routing'
import { urlFor } from '../src/url'

registerMiddlewareRegistry({ aliases: {} })

class PhotoController extends Controller {
  async index() { return [] }
  async create() { return {} }
  async show() { return {} }
}

describe('resource({ names })', () => {
  test('overrides one action while the rest keep the uniform <name>.<action>', () => {
    new Elysia().use(
      resource('/photos', PhotoController, {
        only: ['index', 'create', 'show'],
        name: 'photos',
        names: { create: 'photos.build' },
      }),
    )

    expect(urlFor('photos.build')).toBe('/photos/create')
    expect(urlFor('photos.index')).toBe('/photos')
    expect(urlFor('photos.show', { id: '5' })).toBe('/photos/5')
  })

  test('works even with no base `name` set at all', () => {
    new Elysia().use(
      resource('/photos', PhotoController, {
        only: ['create'],
        names: { create: 'standalone.create' },
      }),
    )
    expect(urlFor('standalone.create')).toBe('/photos/create')
  })
})
