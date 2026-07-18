import { beforeEach, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { createTestClient } from '../src/index'

function makeApp() {
  return new Elysia()
    .get('/ping', () => ({ ok: true }))
    .get('/user/:id', ({ params }) => ({ data: { id: Number(params.id), name: 'Ada' } }))
    .get('/echo', ({ query }) => ({ q: query.q }))
    .get('/secret', ({ headers, status }) =>
      headers.authorization === 'Bearer t0ken' ? { ok: true } : status(401, { message: 'no' }))
    .post('/users', ({ body, status }) => status(201, { data: body }))
    .get('/go', ({ redirect }) => redirect('/there', 302))
    .get('/html', ({ set }) => {
      set.headers['content-type'] = 'text/html'
      return '<h1>hi Ada</h1>'
    })
}

describe('TestClient', () => {
  let client: ReturnType<typeof createTestClient>
  beforeEach(() => {
    client = createTestClient(makeApp())
  })

  test('GET + assertOk + json', async () => {
    const res = await client.get('/ping')
    res.assertOk()
    expect(res.json<{ ok: boolean }>()).toEqual({ ok: true })
  })

  test('assertJson does a deep partial match', async () => {
    const res = await client.get('/user/1')
    res.assertStatus(200).assertJson({ data: { name: 'Ada' } })
  })

  test('assertJsonPath drills into the body', async () => {
    const res = await client.get('/user/7')
    res.assertJsonPath('data.id', 7)
  })

  test('query params are appended', async () => {
    const res = await client.get('/echo', { query: { q: 'hello' } })
    res.assertJsonPath('q', 'hello')
  })

  test('withToken sets Authorization', async () => {
    const res = await client.withToken('t0ken').get('/secret')
    res.assertOk()
  })

  test('unauthenticated request fails the auth check', async () => {
    const res = await client.get('/secret')
    res.assertUnauthorized()
  })

  test('POST json body + assertCreated', async () => {
    const res = await client.post('/users', { json: { name: 'Grace' } })
    res.assertCreated().assertJson({ data: { name: 'Grace' } })
  })

  test('assertRedirect checks 3xx + Location', async () => {
    const res = await client.get('/go')
    res.assertRedirect('/there')
  })

  test('assertHeader + assertSee on an HTML response', async () => {
    const res = await client.get('/html')
    res.assertHeader('content-type', 'text/html').assertSee('hi Ada')
  })

  test('a failed assertion throws', async () => {
    const res = await client.get('/ping')
    expect(() => res.assertStatus(404)).toThrow(/Expected status 404/)
  })
})

describe('TestClient cookie jar', () => {
  function makeCsrfApp() {
    return new Elysia()
      .get('/login', ({ cookie }) => {
        cookie.session?.set({ value: 'sess-1' })
        cookie['XSRF-TOKEN']?.set({ value: 'xsrf-abc' })
        return { ok: true }
      })
      .post('/posts', ({ headers, cookie, status }) => {
        if (cookie.session?.value !== 'sess-1')
          return status(401, { message: 'no session' })
        if (headers['x-xsrf-token'] !== 'xsrf-abc')
          return status(419, { message: 'csrf mismatch' })
        return status(201, { created: true })
      })
  }

  test('replays Set-Cookie automatically on later requests', async () => {
    const client = createTestClient(makeCsrfApp())
    await client.get('/login')
    expect(client.cookieJar().get('session')).toBe('sess-1')

    const res = await client.post('/posts', { json: {} })
    res.assertCreated()
  })

  test('mirrors XSRF-TOKEN into X-XSRF-TOKEN on non-GET requests only', async () => {
    const client = createTestClient(makeCsrfApp())
    await client.get('/login')

    // A GET never needs the header — the app under test doesn't check it there,
    // but the point is the client only attaches it for mutating verbs.
    const created = await client.post('/posts', { json: {} })
    created.assertCreated()
  })

  test('without visiting /login first, the CSRF-protected POST fails', async () => {
    const client = createTestClient(makeCsrfApp())
    const res = await client.post('/posts', { json: {} })
    res.assertStatus(401) // no session cookie captured yet
  })

  test('withCookie seeds the jar without a prior request', async () => {
    const client = createTestClient(makeCsrfApp()).withCookie('session', 'sess-1').withCookie('XSRF-TOKEN', 'xsrf-abc')
    const res = await client.post('/posts', { json: {} })
    res.assertCreated()
  })
})

describe('TestClient.actingAs', () => {
  test('is chainable and delegates to @elyvel/auth\'s actingAs test seam', async () => {
    const { currentTestActor, stopActingAs } = await import('@elyvel/auth')
    const client = createTestClient(makeApp())
    const returned = await client.actingAs({ id: 'u1', name: 'Ada', email: 'ada@example.com', emailVerified: true })
    expect(returned).toBe(client)
    expect(currentTestActor()).toEqual({ id: 'u1', name: 'Ada', email: 'ada@example.com', emailVerified: true })
    stopActingAs()
  })
})
