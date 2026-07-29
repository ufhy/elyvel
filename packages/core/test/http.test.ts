import type { ResolvedSessionConfig } from '../src/session'
import { HttpException } from '@elyvel/support'
import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { errorPages } from '../src/http/error-pages'
import { download, file, streamDownload } from '../src/http/file'
import { methodOverride } from '../src/http/method-override'
import { expectsJson, wantsHtml } from '../src/http/negotiation'
import { httpResponses } from '../src/http/plugin'
import { back, redirect } from '../src/http/redirect'
import { Resource } from '../src/http/resource'
import { staticFiles } from '../src/http/static'
import { requestContext } from '../src/request-context'
import { sessionPlugin } from '../src/session'

// ── negotiation (pure) ────────────────────────────────────────────────────────
const req = (headers: Record<string, string>) => new Request('http://localhost/', { headers })

describe('expectsJson', () => {
  test('true for AJAX and application/json accept', () => {
    expect(expectsJson(req({ 'x-requested-with': 'XMLHttpRequest' }))).toBe(true)
    expect(expectsJson(req({ accept: 'application/json' }))).toBe(true)
  })
  test('false for browser HTML accept and Inertia', () => {
    expect(expectsJson(req({ accept: 'text/html,application/xhtml+xml' }))).toBe(false)
    expect(expectsJson(req({ 'x-inertia': 'true' }))).toBe(false)
  })
  test('Inertia wins even though its own client also sends X-Requested-With: XMLHttpRequest', () => {
    expect(expectsJson(req({ 'x-inertia': 'true', 'x-requested-with': 'XMLHttpRequest' }))).toBe(false)
  })
  test('falls back to content-type, defaults to web', () => {
    expect(expectsJson(req({ 'content-type': 'application/json' }))).toBe(true)
    expect(expectsJson(req({}))).toBe(false)
    expect(wantsHtml(req({}))).toBe(true)
  })
})

// ── Resource (pure) ───────────────────────────────────────────────────────────
describe('Resource', () => {
  test('item / collection / paginated shape the envelope', () => {
    expect(Resource.item({ id: 1, name: 'a' })).toEqual({ data: { id: 1, name: 'a' } })
    expect(Resource.collection([{ id: 1 }], u => u.id)).toEqual({ data: [1] })
    expect(Resource.paginated({ data: [{ id: 1 }], total: 1, perPage: 15 })).toEqual({
      data: [{ id: 1 }],
      meta: { total: 1, perPage: 15 },
    })
  })

  test('when() includes the key only if the condition holds, else omits it', () => {
    const build = (isAdmin: boolean) =>
      Resource.item({ id: 1 }, u => ({ id: u.id, role: Resource.when(isAdmin, 'admin') }))
    expect(build(true)).toEqual({ data: { id: 1, role: 'admin' } })
    expect(build(false)).toEqual({ data: { id: 1 } }) // key stripped, not null
  })

  test('when() defers a thunk until the condition is truthy', () => {
    let called = false
    const val = () => {
      called = true
      return 'x'
    }
    Resource.item({ id: 1 }, () => ({ v: Resource.when(false, val) }))
    expect(called).toBe(false)
  })

  test('whenLoaded() includes a relation only when eager-loaded', () => {
    const withPosts = { relations: { posts: [{ id: 9 }] } }
    const without = { relations: {} }
    const shape = (m: { relations: Record<string, unknown> }) =>
      Resource.item(m, () => ({ posts: Resource.whenLoaded(m, 'posts') }))
    expect(shape(withPosts)).toEqual({ data: { posts: [{ id: 9 }] } })
    expect(shape(without)).toEqual({ data: {} }) // no lazy N+1, key omitted
  })
})

// ── method spoofing ───────────────────────────────────────────────────────────
describe('methodOverride', () => {
  const post = (init: RequestInit = {}) =>
    new Request('http://localhost/x', { method: 'POST', ...init })

  test('X-HTTP-Method-Override header', async () => {
    expect(
      (await methodOverride(post({ headers: { 'x-http-method-override': 'PUT' } }))).method,
    ).toBe('PUT')
  })
  test('?_method query', async () => {
    const req = new Request('http://localhost/x?_method=delete', { method: 'POST' })
    expect((await methodOverride(req)).method).toBe('DELETE')
  })
  test('_method in a form body, body still readable', async () => {
    const req = post({
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: '_method=PATCH&name=Sam',
    })
    const out = await methodOverride(req)
    expect(out.method).toBe('PATCH')
    expect(await out.text()).toContain('name=Sam') // body preserved for the handler
  })
  test('JSON bodies are left untouched (spoof via header/query, not JSON body)', async () => {
    const req = post({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ _method: 'PUT' }),
    })
    const out = await methodOverride(req)
    expect(out.method).toBe('POST')
    expect(await out.text()).toContain('_method') // body intact, not consumed
  })
  test('leaves GET and unspoofable methods alone', async () => {
    expect((await methodOverride(new Request('http://localhost/x'))).method).toBe('GET')
    expect(
      (await methodOverride(post({ headers: { 'x-http-method-override': 'GET' } }))).method,
    ).toBe('POST')
  })
  test('routes a spoofed POST to a PUT route', async () => {
    const app = new Elysia().put('/items/:id', ({ params }) => ({ updated: params.id }))
    const spoofed = await methodOverride(
      new Request('http://localhost/items/7', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: '_method=PUT',
      }),
    )
    const res = await app.handle(spoofed)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ updated: '7' })
  })
})

// ── file / download / stream responses ───────────────────────────────────────
describe('file responses', () => {
  const app = () =>
    new Elysia()
      .use(httpResponses())
      .get('/export', () =>
        streamDownload('users.csv', 'id,name\n1,Sam\n', { contentType: 'text/csv' }))
      .get('/logo', () => download('package.json', 'pkg.json', { contentType: 'application/json' }))
      .get('/stream', () =>
        streamDownload(
          'feed.txt',
          (async function* () {
            yield 'a'
            yield 'b'
          })(),
        ))
      .get('/inline', () => file('package.json'))

  test('download() sets attachment + filename and sends the content', async () => {
    const res = await app().handle(new Request('http://localhost/export'))
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="users.csv"')
    expect(res.headers.get('content-type')).toContain('text/csv')
    expect(await res.text()).toBe('id,name\n1,Sam\n')
  })

  test('download() serves a path as an attachment', async () => {
    const res = await app().handle(new Request('http://localhost/logo'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="pkg.json"')
    expect(await res.text()).toContain('"name"')
  })

  test('streamDownload() streams with an attachment header', async () => {
    const res = await app().handle(new Request('http://localhost/stream'))
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="feed.txt"')
    expect(await res.text()).toBe('ab')
  })

  test('file() serves a path inline', async () => {
    const res = await app().handle(new Request('http://localhost/inline'))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('"name"')
  })
})

// ── static file serving ───────────────────────────────────────────────────────
describe('staticFiles', () => {
  const app = () => new Elysia().use(staticFiles({ prefix: '/assets', dir: '.' }))

  test('serves an existing file', async () => {
    const res = await app().handle(new Request('http://localhost/assets/package.json'))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('"workspaces"')
  })

  test('404s a missing file', async () => {
    const res = await app().handle(new Request('http://localhost/assets/nope.xyz'))
    expect(res.status).toBe(404)
  })

  test('does not serve files outside the served dir (traversal blocked)', async () => {
    const res = await app().handle(new Request('http://localhost/assets/..%2f..%2fetc%2fpasswd'))
    expect(res.status).not.toBe(200) // 403 (guard) or 404 (normalized) — never leaked
    expect(await res.text()).not.toContain('root:')
  })
})

// ── wired app: redirect + validation negotiation ──────────────────────────────
const sessionConfig: ResolvedSessionConfig = {
  driver: 'cookie',
  cookie: 'elyvel_session',
  lifetime: 7200,
  secret: 'a'.repeat(32),
  files: '',
  path: '/',
  secure: false,
  httpOnly: true,
  sameSite: 'lax',
  expireOnClose: false,
}

function buildApp() {
  // Mount order mirrors the Application: request-context (logs), httpResponses,
  // session (422 web redirect-back), then errorPages (renders page/JSON).
  return new Elysia()
    .use(requestContext())
    .use(httpResponses())
    .use(sessionPlugin(sessionConfig))
    .use(errorPages())
    .post('/save', () => redirect('/done').with('status', 'saved'))
    .post('/save-back', () => back().withErrors({ email: ['taken'] }))
    // A real client-facing exception. This used to be a bare `Error` with
    // `status`/`errors` slapped on, which the renderer trusted — that loophole is
    // closed, so the test now throws what an app is supposed to throw.
    .post('/validate', () => {
      throw new HttpException(422, 'invalid', {
        name: ['required'],
        email: ['must be valid', 'is required'],
      })
    })
    // A foreign error that merely LOOKS like a validation failure. Must not be
    // able to drive the redirect-back-and-flash path.
    .post('/fake-validate', () => {
      throw Object.assign(new Error('ECONNREFUSED 10.0.0.5 postgres://u:pw@db'), {
        status: 422,
        errors: { internal: ['secret detail'] },
      })
    })
    .get('/flashed-errors', (ctx: any) => ctx.session?.get('errors') ?? null)
}

describe('redirect responses', () => {
  test('redirect() → 303 with Location', async () => {
    const res = await buildApp().handle(new Request('http://localhost/save', { method: 'POST' }))
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/done')
    expect(res.headers.get('set-cookie')).toContain('elyvel_session=') // flash persisted
  })

  test('back() resolves to the Referer', async () => {
    const res = await buildApp().handle(
      new Request('http://localhost/save-back', { method: 'POST', headers: { referer: '/form' } }),
    )
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/form')
  })

  test('back() ignores a cross-origin Referer (open-redirect guard)', async () => {
    const res = await buildApp().handle(
      new Request('http://localhost/save-back', {
        method: 'POST',
        headers: { referer: 'https://evil.example.com/phish' },
      }),
    )
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/') // not the attacker origin
  })
})

describe('validation negotiation', () => {
  test('web request → redirect back with errors flashed', async () => {
    const res = await buildApp().handle(
      new Request('http://localhost/validate', {
        method: 'POST',
        headers: { accept: 'text/html', referer: '/form' },
      }),
    )
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/form')
    expect(res.headers.get('set-cookie')).toContain('elyvel_session=')
  })

  test('flashed errors are flattened to one message per field (Inertia\'s form.errors.field convention), not Laravel\'s raw array bag', async () => {
    const app = buildApp()
    const res = await app.handle(
      new Request('http://localhost/validate', {
        method: 'POST',
        headers: { accept: 'text/html', referer: '/form' },
      }),
    )
    const cookie = res.headers.get('set-cookie')!.split(';')[0]!

    const follow = await app.handle(
      new Request('http://localhost/flashed-errors', { headers: { cookie } }),
    )
    expect(await follow.json()).toEqual({ name: 'required', email: 'must be valid' })
  })

  /**
   * Regression: this path matched on a bare `status === 422 && errors !== undefined`,
   * so a foreign error carrying both — an outbound HTTP client rejection, say —
   * redirected the user back with its internals flashed into the session and
   * rendered on the page. Only a client-facing `HttpException` may drive it.
   */
  test('a foreign error that looks like a 422 does not flash anything', async () => {
    const app = buildApp()
    const res = await app.handle(
      new Request('http://localhost/fake-validate', {
        method: 'POST',
        headers: { accept: 'text/html', referer: 'http://localhost/form' },
      }),
    )

    // A generic 500 page, not a 303 back to the form.
    expect(res.status).toBe(500)
    const html = await res.text()
    expect(html).not.toContain('secret detail')
    expect(html).not.toContain('10.0.0.5')
    expect(html).not.toContain('postgres://')
  })

  test('API request → 422 JSON with the error bag', async () => {
    const res = await buildApp().handle(
      new Request('http://localhost/validate', {
        method: 'POST',
        headers: { accept: 'application/json' },
      }),
    )
    expect(res.status).toBe(422)
    const body = (await res.json()) as { message: string, errors: Record<string, unknown> }
    expect(body.errors).toEqual({ name: ['required'], email: ['must be valid', 'is required'] })
  })
})
