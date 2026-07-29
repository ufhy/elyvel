import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { group, registerMiddlewareRegistry } from '../src/middleware'
import { CsrfMiddleware } from '../src/session'

/** A route tree with a session on the context, so CsrfMiddleware actually runs. */
function appWithGroup(name: string): Elysia {
  return new Elysia()
    .derive({ as: 'global' }, () => ({ session: { token: () => 'the-real-token' } }))
    .use(group(name))
    .post('/save', () => 'saved') as unknown as Elysia
}

function post(app: Elysia, headers: Record<string, string> = {}): Promise<Response> {
  return app.handle(new Request('http://localhost/save', { method: 'POST', headers }))
}

/**
 * Regression: the Application built the group map as
 * `{ web: ['csrf'], ...config.groups }`, so an app defining its own `web` group
 * REPLACED the built-in one and silently stopped applying `CsrfMiddleware` to
 * every session route — a security control disappearing on an unrelated config
 * edit, with nothing warning about it.
 */
describe('the web middleware group always includes csrf', () => {
  test('an app that wipes the web group is still CSRF-protected', async () => {
    registerMiddlewareRegistry({ aliases: { csrf: CsrfMiddleware }, groups: { web: [] } })

    const response = await post(appWithGroup('web'))
    expect(response.status).toBe(419)
  })

  test('an app that replaces the web group with its own entries is still protected', async () => {
    registerMiddlewareRegistry({ aliases: { csrf: CsrfMiddleware }, groups: { web: ['noop'] } })

    const response = await post(appWithGroup('web'))
    expect(response.status).toBe(419)
  })

  test('a valid token still passes — csrf is enforced, not just present', async () => {
    registerMiddlewareRegistry({ aliases: { csrf: CsrfMiddleware }, groups: { web: [] } })

    const response = await post(appWithGroup('web'), { 'x-csrf-token': 'the-real-token' })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('saved')
  })

  test('only web is special — other groups do not get csrf forced into them', async () => {
    registerMiddlewareRegistry({
      aliases: { csrf: CsrfMiddleware },
      groups: { api: [], web: [] },
    })

    // An API group is token-free by design; forcing csrf in would break every
    // stateless client.
    const response = await post(appWithGroup('api'))
    expect(response.status).toBe(200)
  })
})
