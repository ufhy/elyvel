import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import {
  globalMiddlewarePlugin,
  group,
  Middleware,
  type MiddlewareContext,
  registerMiddlewareRegistry,
  route,
} from '../src/middleware'

class AuthMiddleware extends Middleware {
  handle(ctx: MiddlewareContext) {
    if (!ctx.request.headers.get('authorization')) return ctx.status(401, { message: 'no' })
  }
}
class ThrottleMiddleware extends Middleware {
  handle(ctx: MiddlewareContext, max = '0', per = '0') {
    ctx.set.headers['x-throttle'] = `${max}/${per}`
  }
}
class GlobalTag extends Middleware {
  handle(ctx: MiddlewareContext) {
    ctx.set.headers['x-global'] = 'yes'
  }
}

function buildApp() {
  registerMiddlewareRegistry({
    aliases: { auth: AuthMiddleware, throttle: ThrottleMiddleware },
    groups: { api: ['auth'] },
  })
  return new Elysia()
    .use(globalMiddlewarePlugin([GlobalTag]))
    .use(
      route('/r')
        .get('/open', () => 'ok')
        .get('/secure', () => 'secret', { middleware: 'auth' })
        .get('/limited', () => 'lim', { middleware: ['throttle:2,1'] }),
    )
    .use(
      route('/api')
        .use(group('api'))
        .get('/list', () => 'list'),
    )
}

describe('middleware', () => {
  const app = buildApp()

  test('global middleware runs on every request', async () => {
    const res = await app.handle(new Request('http://localhost/r/open'))
    expect(res.headers.get('x-global')).toBe('yes')
    expect(await res.text()).toBe('ok')
  })

  test('route alias blocks without auth, passes with it', async () => {
    const denied = await app.handle(new Request('http://localhost/r/secure'))
    expect(denied.status).toBe(401)

    const ok = await app.handle(
      new Request('http://localhost/r/secure', { headers: { authorization: 'Bearer t' } }),
    )
    expect(ok.status).toBe(200)
    expect(await ok.text()).toBe('secret')
  })

  test('alias parameters reach handle(...args)', async () => {
    const res = await app.handle(new Request('http://localhost/r/limited'))
    expect(res.headers.get('x-throttle')).toBe('2/1')
  })

  test('group applies its middleware to the routes that use it', async () => {
    const denied = await app.handle(new Request('http://localhost/api/list'))
    expect(denied.status).toBe(401)

    const ok = await app.handle(
      new Request('http://localhost/api/list', { headers: { authorization: 'Bearer t' } }),
    )
    expect(await ok.text()).toBe('list')
  })

  test('unknown alias throws a helpful error', async () => {
    registerMiddlewareRegistry({ aliases: {} })
    const bad = new Elysia().use(route().get('/x', () => 'x', { middleware: 'nope' }))
    const res = await bad.handle(new Request('http://localhost/x'))
    expect(res.status).toBeGreaterThanOrEqual(500)
  })
})
