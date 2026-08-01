import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { errorPageResolver } from '@elyvel/core'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { spa } from '../src/spa'
import { viteTags } from '../src/tags'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'elyvel-vite-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** The hot file as the `elyvel()` plugin writes it: dev URL WITH vite's base. */
function hot(contents = 'http://localhost:5173/build'): string {
  const path = join(dir, 'hot')
  writeFileSync(path, contents)
  return path
}

function manifest(): string {
  const path = join(dir, 'manifest.json')
  writeFileSync(
    path,
    JSON.stringify({ 'frontend/app.ts': { file: 'assets/app-abc123.js', css: ['assets/app-abc123.css'] } }),
  )
  return path
}

/**
 * The dev-vs-build decision is the hot file's existence — never the environment.
 * `APP_ENV` used to decide it, which is a different question: unset on a real
 * deploy it emitted `http://localhost:5173/...` asset URLs to visitors (page
 * renders, every asset 404s, server logs nothing), and set to production locally
 * it served a stale `public/build/` over the running dev server.
 */
describe('viteTags — a running dev server is detected by the hot file', () => {
  test('hot file present: dev client + entry, built from its contents', () => {
    const tags = viteTags({ entry: 'frontend/app.ts', hotFile: hot(), manifest: manifest() })
    expect(tags).toContain('http://localhost:5173/build/@vite/client')
    expect(tags).toContain('http://localhost:5173/build/frontend/app.ts')
    // Even with a manifest sitting right there — a live dev server wins.
    expect(tags).not.toContain('app-abc123.js')
  })

  test('the base is NOT appended twice — the hot file already carries it', () => {
    const tags = viteTags({ entry: 'app.ts', hotFile: hot('http://localhost:5173/assets'), base: '/assets/' })
    expect(tags).toContain('http://localhost:5173/assets/@vite/client')
    expect(tags).not.toContain('/assets/assets/')
  })

  test('a custom host/port in the hot file is used verbatim', () => {
    const tags = viteTags({ entry: 'app.ts', hotFile: hot('https://vite.test:4000/build') })
    expect(tags).toContain('https://vite.test:4000/build/app.ts')
  })

  for (const env of ['local', 'production', undefined]) {
    test(`APP_ENV=${env ?? '(unset)'} changes nothing`, () => {
      const saved = process.env.APP_ENV
      if (env === undefined)
        delete process.env.APP_ENV
      else process.env.APP_ENV = env
      try {
        expect(viteTags({ entry: 'app.ts', hotFile: hot() })).toContain('@vite/client')
        expect(viteTags({ entry: 'frontend/app.ts', hotFile: join(dir, 'none'), manifest: manifest() }))
          .toContain('/build/assets/app-abc123.js')
      }
      finally {
        if (saved === undefined)
          delete process.env.APP_ENV
        else process.env.APP_ENV = saved
      }
    })
  }

  test('devUrl forces dev tags even with no dev server running', () => {
    const tags = viteTags({ entry: 'app.ts', devUrl: 'http://tunnel.test', hotFile: join(dir, 'none') })
    expect(tags).toContain('http://tunnel.test/build/@vite/client')
  })
})

describe('viteTags — no dev server', () => {
  test('serves the built assets from the manifest', () => {
    const tags = viteTags({ entry: 'frontend/app.ts', manifest: manifest(), hotFile: join(dir, 'none') })
    expect(tags).toContain('/build/assets/app-abc123.js')
    expect(tags).toContain('/build/assets/app-abc123.css')
    expect(tags).not.toContain('@vite/client')
  })

  test('no dev server AND no build throws, instead of shipping localhost URLs', () => {
    expect(() => viteTags({ entry: 'app.ts', manifest: join(dir, 'none.json'), hotFile: join(dir, 'none') }))
      .toThrow(/No Vite dev server and no build manifest/)
  })

  test('a missing entry throws instead of emitting dev-server URLs', () => {
    expect(() => viteTags({ entry: 'frontend/missing.ts', manifest: manifest(), hotFile: join(dir, 'none') }))
      .toThrow(/is not in the Vite manifest/)
  })
})

describe('spa()', () => {
  const app = () =>
    new Elysia().use(spa({ entry: 'frontend/spa.ts', prefix: '/dashboard', buildDir: '.', devUrl: 'http://localhost:5173' }))

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
      .use(spa({ entry: 'frontend/spa.ts', prefix: '/dashboard', buildDir: '.', devUrl: 'http://localhost:5173' }))
    const res = await withApi.handle(new Request('http://localhost/api/health'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
