import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
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
