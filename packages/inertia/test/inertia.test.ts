import { afterEach, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { inertia } from '../src/plugin'
import { Inertia } from '../src/response'

afterEach(() => Inertia.flushShared())

const build = (config = {}) =>
  new Elysia()
    .use(inertia(config))
    .get('/home', () => Inertia.render('Home', { name: 'Sam' }))
    .get('/lazy', () =>
      Inertia.render('Lazy', {
        always: Inertia.always(() => 'A'),
        maybe: Inertia.optional(() => 'M'),
        normal: 'N',
      }),
    )
    .get('/external', () => Inertia.location('https://example.com'))

const inertiaReq = (path: string, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, { headers: { 'x-inertia': 'true', 'x-inertia-version': '', ...headers } })

describe('first (non-XHR) load', () => {
  test('returns an HTML document embedding the page object', async () => {
    const res = await build().handle(new Request('http://localhost/home'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const body = await res.text()
    expect(body).toContain('<div id="app" data-page="')
    expect(body).toContain('&quot;component&quot;:&quot;Home&quot;') // JSON escaped into the attribute
    expect(body).toContain('Sam')
  })

  test('vite tags inject the dev client + entry when no manifest', async () => {
    const res = await build({ vite: { entry: 'resources/js/app.ts' } }).handle(new Request('http://localhost/home'))
    const body = await res.text()
    expect(body).toContain('http://localhost:5173/@vite/client')
    expect(body).toContain('http://localhost:5173/resources/js/app.ts')
  })
})

describe('inertia XHR visit', () => {
  test('returns the JSON page object with X-Inertia headers', async () => {
    const res = await build().handle(inertiaReq('/home'))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-inertia')).toBe('true')
    expect(res.headers.get('vary')).toBe('X-Inertia')
    const page = (await res.json()) as { component: string; props: Record<string, unknown>; url: string }
    expect(page.component).toBe('Home')
    expect(page.props.name).toBe('Sam')
    expect(page.props.errors).toEqual({}) // errors always shared
    expect(page.url).toBe('/home')
  })
})

describe('asset versioning', () => {
  test('version mismatch → 409 with X-Inertia-Location', async () => {
    const res = await build({ version: 'v2' }).handle(inertiaReq('/home', { 'x-inertia-version': 'v1' }))
    expect(res.status).toBe(409)
    expect(res.headers.get('x-inertia-location')).toBe('http://localhost/home')
  })
  test('matching version → 200', async () => {
    const res = await build({ version: 'v2' }).handle(inertiaReq('/home', { 'x-inertia-version': 'v2' }))
    expect(res.status).toBe(200)
  })
})

describe('partial reloads', () => {
  test('only requested props are returned; always kept; optional included when asked', async () => {
    const res = await build().handle(
      inertiaReq('/lazy', { 'x-inertia-partial-component': 'Lazy', 'x-inertia-partial-data': 'maybe' }),
    )
    const page = (await res.json()) as { props: Record<string, unknown> }
    expect(page.props.maybe).toBe('M') // optional, explicitly requested
    expect(page.props.always).toBe('A') // always, kept even in `only`
    expect(page.props.normal).toBeUndefined() // filtered out
  })

  test('optional props are absent on a full visit', async () => {
    const res = await build().handle(inertiaReq('/lazy'))
    const page = (await res.json()) as { props: Record<string, unknown> }
    expect(page.props.normal).toBe('N')
    expect(page.props.always).toBe('A')
    expect(page.props.maybe).toBeUndefined() // optional never on full visit
  })
})

describe('shared props', () => {
  test('Inertia.share merges into every page', async () => {
    Inertia.share('appName', 'Ravel')
    Inertia.share('user', () => ({ id: 1 }))
    const res = await build().handle(inertiaReq('/home'))
    const page = (await res.json()) as { props: Record<string, unknown> }
    expect(page.props.appName).toBe('Ravel')
    expect(page.props.user).toEqual({ id: 1 })
  })
})

describe('Inertia.location', () => {
  test('409 + X-Inertia-Location for XHR, 302 otherwise', async () => {
    const xhr = await build().handle(inertiaReq('/external'))
    expect(xhr.status).toBe(409)
    expect(xhr.headers.get('x-inertia-location')).toBe('https://example.com')

    const plain = await build().handle(new Request('http://localhost/external'))
    expect(plain.status).toBe(302)
    expect(plain.headers.get('location')).toBe('https://example.com')
  })
})
