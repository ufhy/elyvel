import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { spa } from '../src/spa'
import { viteTags } from '../src/tags'

describe('viteTags', () => {
  test('emits the dev client + entry when no manifest exists', () => {
    const tags = viteTags({ entry: 'resources/js/app.ts', manifest: 'does/not/exist.json' })
    expect(tags).toContain('http://localhost:5173/@vite/client')
    expect(tags).toContain('http://localhost:5173/resources/js/app.ts')
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

  test('serves the shell for deep links under the prefix (client routing)', async () => {
    const res = await app().handle(new Request('http://localhost/dashboard/settings/profile'))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<div id="app"></div>')
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
