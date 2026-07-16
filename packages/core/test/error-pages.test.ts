import { afterEach, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { configureErrorPage } from '../src/http/error-page'
import { errorPages } from '../src/http/error-pages'

function makeApp() {
  return new Elysia()
    .use(errorPages())
    .get('/ok', () => ({ ok: true }))
    .get('/boom', () => {
      throw new Error('secret internal detail')
    })
    .get('/forbidden', ({ status }: any) => status(403, { message: 'This action is unauthorized.' })) as any
}

async function get(app: any, path: string, accept: string) {
  const res = await app.handle(new Request(`http://localhost${path}`, { headers: { accept } }))
  return { status: res.status, type: res.headers.get('content-type') ?? '', body: await res.text() }
}

describe('error pages', () => {
  const app = makeApp()

  test('404 (unmatched): HTML page for browsers, JSON for API', async () => {
    const html = await get(app, '/missing', 'text/html')
    expect(html.status).toBe(404)
    expect(html.type).toContain('text/html')
    expect(html.body).toContain('Page Not Found')
    expect(html.body).toContain('>404<') // the big status numeral

    const json = await get(app, '/missing', 'application/json')
    expect(json.status).toBe(404)
    expect(json.type).toContain('application/json')
    expect(JSON.parse(json.body)).toMatchObject({ status: 404 })
  })

  test('403 (returned status): HTML for browsers, JSON keeps the message for API', async () => {
    const html = await get(app, '/forbidden', 'text/html')
    expect(html.status).toBe(403)
    expect(html.type).toContain('text/html')
    expect(html.body).toContain('Forbidden')

    const json = await get(app, '/forbidden', 'application/json')
    expect(json.status).toBe(403)
    expect(JSON.parse(json.body).message).toBe('This action is unauthorized.')
  })

  test('500 (thrown): renders a page but never leaks the internal error message', async () => {
    const html = await get(app, '/boom', 'text/html')
    expect(html.status).toBe(500)
    expect(html.body).toContain('Server Error')
    expect(html.body).not.toContain('secret internal detail')

    const json = await get(app, '/boom', 'application/json')
    expect(json.status).toBe(500)
    expect(json.body).not.toContain('secret internal detail')
  })

  test('successful responses pass through untouched', async () => {
    const ok = await get(app, '/ok', 'text/html')
    expect(ok.status).toBe(200)
    expect(JSON.parse(ok.body)).toEqual({ ok: true })
  })
})

describe('configureErrorPage (custom pages)', () => {
  afterEach(() => configureErrorPage(null))

  test('custom resolver renders on the web lane; API JSON is untouched', async () => {
    let calls = 0
    configureErrorPage((status, { message }) => {
      calls++
      return status === 404 ? `<h1>Custom ${status}</h1><p>${message ?? ''}</p>` : undefined
    })
    const app = makeApp()

    const html = await get(app, '/missing', 'text/html')
    expect(html.status).toBe(404)
    expect(html.body).toContain('<h1>Custom 404</h1>')

    // API request must NOT hit the resolver — always JSON (no conflict).
    const callsBefore = calls
    const json = await get(app, '/missing', 'application/json')
    expect(json.type).toContain('application/json')
    expect(JSON.parse(json.body)).toMatchObject({ status: 404 })
    expect(calls).toBe(callsBefore) // resolver was not called for JSON
  })

  test('returning undefined falls back to the default page', async () => {
    configureErrorPage(() => undefined)
    const app = makeApp()
    const html = await get(app, '/missing', 'text/html')
    expect(html.status).toBe(404)
    expect(html.body).toContain('Page Not Found') // framework default
  })

  test('a resolver may return a full Response', async () => {
    configureErrorPage(() => new Response('gone', { status: 410, headers: { 'content-type': 'text/plain' } }))
    const app = makeApp()
    const res = await get(app, '/missing', 'text/html')
    expect(res.status).toBe(410)
    expect(res.body).toBe('gone')
  })
})
