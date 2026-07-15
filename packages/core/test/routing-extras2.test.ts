import { beforeEach, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { cors } from '../src/cors'
import { registerMiddlewareRegistry, route } from '../src/middleware'
import { fallback } from '../src/routing'
import { ThrottleMiddleware, rateLimiter } from '../src/throttle'
import { clearRouteNames, named, urlFor } from '../src/url'

describe('throttle middleware', () => {
  beforeEach(() => rateLimiter.clear())

  test('allows up to max, then 429 with headers', async () => {
    registerMiddlewareRegistry({ aliases: { throttle: ThrottleMiddleware } })
    const app = new Elysia().use(route().get('/t', () => 'ok', { middleware: 'throttle:2,1' }))
    const hit = () => app.handle(new Request('http://localhost/t'))

    const r1 = await hit()
    expect(r1.status).toBe(200)
    expect(r1.headers.get('x-ratelimit-limit')).toBe('2')
    expect(r1.headers.get('x-ratelimit-remaining')).toBe('1')

    expect((await hit()).status).toBe(200) // 2nd allowed
    const r3 = await hit()
    expect(r3.status).toBe(429)
    expect(r3.headers.get('retry-after')).toBeDefined()
  })
})

describe('cors', () => {
  const app = new Elysia()
    .use(cors({ origin: 'https://app.test', credentials: true }))
    .get('/', () => 'ok')

  test('sets CORS headers on responses', async () => {
    const res = await app.handle(new Request('http://localhost/'))
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.test')
    expect(res.headers.get('access-control-allow-credentials')).toBe('true')
  })

  test('answers preflight OPTIONS with 204', async () => {
    const res = await app.handle(new Request('http://localhost/', { method: 'OPTIONS' }))
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-methods')).toContain('GET')
  })
})

describe('fallback route', () => {
  test('runs when no route matches', async () => {
    const app = new Elysia()
      .get('/known', () => 'known')
      .use(fallback((ctx) => ctx.status(404, { message: 'nope', fallback: true })))

    expect(await (await app.handle(new Request('http://localhost/known'))).text()).toBe('known')
    const missing = await app.handle(new Request('http://localhost/does-not-exist'))
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ message: 'nope', fallback: true })
  })
})

describe('named routes + urlFor', () => {
  beforeEach(() => clearRouteNames())

  test('substitutes params and appends extras as query', () => {
    named('users.show', '/users/:id')
    named('users.index', '/users')
    expect(urlFor('users.show', { id: 1 })).toBe('/users/1')
    expect(urlFor('users.index', { page: 2, q: 'ada' })).toBe('/users?page=2&q=ada')
  })

  test('throws on unknown name or missing param', () => {
    named('posts.show', '/posts/:id')
    expect(() => urlFor('nope')).toThrow(/No named route/)
    expect(() => urlFor('posts.show', {})).toThrow(/Missing parameter/)
  })
})
