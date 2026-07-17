import { afterEach, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { createApp } from '../src/application'
import { group, registerMiddlewareRegistry } from '../src/middleware'
import { CsrfMiddleware } from '../src/session'

const basePath = new URL('./fixtures', import.meta.url).pathname

function webApp() {
  registerMiddlewareRegistry({
    aliases: { csrf: CsrfMiddleware },
    groups: { web: ['csrf'] },
  })
  return new Elysia()
    .decorate('session', { token: () => 'secret' })
    .use(group('web'))
    .get('/', () => 'ok')
    .post('/save', () => 'saved')
}

describe('web middleware group (CSRF)', () => {
  test('GET passes without a token', async () => {
    const res = await webApp().handle(new Request('http://localhost/'))
    expect(res.status).toBe(200)
  })

  test('POST without a matching CSRF token is rejected (419)', async () => {
    const res = await webApp().handle(new Request('http://localhost/save', { method: 'POST' }))
    expect(res.status).toBe(419)
  })

  test('POST with the correct token passes', async () => {
    const res = await webApp().handle(new Request('http://localhost/save', {
      method: 'POST',
      headers: { 'x-csrf-token': 'secret' },
    }))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('saved')
  })
})

describe('default groups', () => {
  afterEach(() => {
    // Reset the registry the fixture app populated so other suites are unaffected.
    registerMiddlewareRegistry({})
  })

  test('the `web` group is registered out of the box (contains csrf)', async () => {
    await createApp({ basePath, autoloadRoutes: false })
    // group('web') resolves without a user-defined config/middleware.ts
    expect(() => group('web')).not.toThrow()
  })
})
