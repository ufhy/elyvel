import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { errorPageResolver } from '@elyvel/core'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { spa } from '../src/spa'
import { viteTags } from '../src/tags'

describe('viteTags', () => {
  test('emits the dev client + entry (under the vite base) when no manifest exists', () => {
    const tags = viteTags({ entry: 'resources/js/app.ts', manifest: 'does/not/exist.json' })
    // The dev server serves under `base` (default /build/), so the injected
    // URLs must include it — without it the module requests 404.
    expect(tags).toContain('http://localhost:5173/build/@vite/client')
    expect(tags).toContain('http://localhost:5173/build/resources/js/app.ts')
  })

  test('dev tags honor a custom base', () => {
    const tags = viteTags({ entry: 'app.ts', manifest: 'nope.json', base: '/assets/' })
    expect(tags).toContain('http://localhost:5173/assets/@vite/client')
    expect(tags).toContain('http://localhost:5173/assets/app.ts')
  })

  describe('with a manifest present', () => {
    let dir: string
    let manifestPath: string
    const savedAppEnv = process.env.APP_ENV

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'elyvel-vite-'))
      manifestPath = join(dir, 'manifest.json')
      writeFileSync(
        manifestPath,
        JSON.stringify({ 'resources/js/app.ts': { file: 'assets/app-abc123.js', css: ['assets/app-abc123.css'] } }),
      )
    })
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true })
      if (savedAppEnv === undefined)
        delete process.env.APP_ENV
      else process.env.APP_ENV = savedAppEnv
    })

    test('is IGNORED outside production — a stale build never shadows the dev server', () => {
      process.env.APP_ENV = 'local'
      const tags = viteTags({ entry: 'resources/js/app.ts', manifest: manifestPath })
      expect(tags).toContain('http://localhost:5173/build/@vite/client')
      expect(tags).not.toContain('assets/app-abc123.js')
    })

    test('is honored when APP_ENV=production', () => {
      process.env.APP_ENV = 'production'
      const tags = viteTags({ entry: 'resources/js/app.ts', manifest: manifestPath })
      expect(tags).toContain('/build/assets/app-abc123.js')
      expect(tags).toContain('/build/assets/app-abc123.css')
      expect(tags).not.toContain('@vite/client')
    })
  })
})

describe('spa()', () => {
  const app = () =>
    new Elysia().use(spa({ entry: 'resources/js/spa.ts', prefix: '/dashboard', buildDir: '.' }))

  test('serves the SPA shell (root div + vite tags) at the prefix', async () => {
    const res = await app().handle(new Request('http://localhost/dashboard'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const body = await res.text()
    expect(body).toContain('<div id="app"></div>')
    expect(body).toContain('@vite/client') // dev tags injected
  })

  test('registers an error-page resolver that serves the shell for browser deep links', async () => {
    app() // calling spa() installs the resolver used for client-side deep links
    const resolve = errorPageResolver()
    expect(resolve).toBeTruthy()

    // A browser 404 on a client route → the SPA shell (200), so vue-router renders.
    const page = await resolve!(404, { request: new Request('http://localhost/settings/profile'), error: null })
    expect(page).toBeInstanceOf(Response)
    expect((page as Response).status).toBe(200)
    expect(await (page as Response).text()).toContain('<div id="app"></div>')

    // API 404s are left alone (they stay JSON), as are asset requests.
    const api = await resolve!(404, { request: new Request('http://localhost/api/nope'), error: null })
    expect(api).toBeUndefined()
  })

  test('a route OUTSIDE the prefix is not shadowed by the SPA', async () => {
    const withApi = new Elysia()
      .get('/api/health', () => ({ ok: true }))
      .use(spa({ entry: 'resources/js/spa.ts', prefix: '/dashboard', buildDir: '.' }))
    const res = await withApi.handle(new Request('http://localhost/api/health'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
