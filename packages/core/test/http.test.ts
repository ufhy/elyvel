import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { expectsJson, wantsHtml } from '../src/http/negotiation'
import { httpResponses } from '../src/http/plugin'
import { back, redirect } from '../src/http/redirect'
import { Resource } from '../src/http/resource'
import { requestContext } from '../src/request-context'
import { type ResolvedSessionConfig, sessionPlugin } from '../src/session'

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
    expect(Resource.collection([{ id: 1 }], (u) => u.id)).toEqual({ data: [1] })
    expect(Resource.paginated({ data: [{ id: 1 }], total: 1, perPage: 15 })).toEqual({
      data: [{ id: 1 }],
      meta: { total: 1, perPage: 15 },
    })
  })
})

// ── wired app: redirect + validation negotiation ──────────────────────────────
const sessionConfig: ResolvedSessionConfig = {
  driver: 'cookie',
  cookie: 'ravel_session',
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
  // Mount order mirrors the Application: request-context, httpResponses, session.
  return new Elysia()
    .use(requestContext())
    .use(httpResponses())
    .use(sessionPlugin(sessionConfig))
    .post('/save', () => redirect('/done').with('status', 'saved'))
    .post('/save-back', () => back().withErrors({ email: ['taken'] }))
    .post('/validate', () => {
      const e = new Error('invalid') as Error & { status: number; errors: Record<string, unknown> }
      e.status = 422
      e.errors = { name: ['required'] }
      throw e
    })
}

describe('redirect responses', () => {
  test('redirect() → 303 with Location', async () => {
    const res = await buildApp().handle(new Request('http://localhost/save', { method: 'POST' }))
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/done')
    expect(res.headers.get('set-cookie')).toContain('ravel_session=') // flash persisted
  })

  test('back() resolves to the Referer', async () => {
    const res = await buildApp().handle(
      new Request('http://localhost/save-back', { method: 'POST', headers: { referer: '/form' } }),
    )
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/form')
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
    expect(res.headers.get('set-cookie')).toContain('ravel_session=')
  })

  test('API request → 422 JSON with the error bag', async () => {
    const res = await buildApp().handle(
      new Request('http://localhost/validate', {
        method: 'POST',
        headers: { accept: 'application/json' },
      }),
    )
    expect(res.status).toBe(422)
    const body = (await res.json()) as { message: string; errors: Record<string, unknown> }
    expect(body.errors).toEqual({ name: ['required'] })
  })
})
