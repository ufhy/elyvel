import { describe, expect, test } from 'bun:test'
import { createApp } from '../src/application'

const basePath = new URL('./fixtures', import.meta.url).pathname

describe('OpenAPI docs', () => {
  test('serves a spec at /openapi/json with document metadata from config', async () => {
    const app = await createApp({ basePath, autoloadRoutes: false })
    const res = await app.handle(new Request('http://localhost/openapi/json'))
    expect(res.status).toBe(200)
    const spec = (await res.json()) as { openapi: string, info: { title: string } }
    expect(spec.openapi).toMatch(/^3\./)
    expect(spec.info.title).toBe('Test App') // derived from config('app.name')
  })

  test('serves the interactive docs UI at /openapi', async () => {
    const app = await createApp({ basePath, autoloadRoutes: false })
    const res = await app.handle(new Request('http://localhost/openapi'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  test('is disabled in production (docs are not exposed by default)', async () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const app = await createApp({ basePath, autoloadRoutes: false })
      const res = await app.handle(new Request('http://localhost/openapi/json'))
      expect(res.status).toBe(404)
    }
    finally {
      process.env.NODE_ENV = prev
    }
  })
})
