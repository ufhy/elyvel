import type { Application } from '../src/application'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
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

  /**
   * This asserted the opposite until the framework stopped reading NODE_ENV to
   * decide exposure. Keeping the environment out is the point: whether an API
   * surface is published now shows up in `config/openapi.ts`, where the person
   * responsible for it will look. The scaffolded config still keeps it off in
   * production — on a line they can read.
   */
  test('NODE_ENV=production does not disable it — only config does', async () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const app = await createApp({ basePath, autoloadRoutes: false })
      const res = await app.handle(new Request('http://localhost/openapi/json'))
      expect(res.status).toBe(200)
    }
    finally {
      process.env.NODE_ENV = prev
    }
  })
})

/**
 * Exposure used to be decided by `app.env !== 'production'` inside the framework,
 * so `config/openapi.ts` could say nothing about it and an operator reading that
 * file learned nothing about whether their API surface was published. It is
 * config-only now — Laravel's Telescope gates itself on
 * `config('telescope.enabled')` and never looks at the environment either.
 */
describe('openapi.enabled comes from config, not app.env', () => {
  let dir: string

  afterEach(() => {
    if (dir)
      rmSync(dir, { recursive: true, force: true })
  })

  async function appWith(env: string, openapi: string): Promise<Application> {
    dir = mkdtempSync(join(tmpdir(), 'elyvel-openapi-'))
    mkdirSync(join(dir, 'config'), { recursive: true })
    writeFileSync(join(dir, 'config', 'app.ts'), `export default { name: 'Test', env: '${env}' }\n`)
    writeFileSync(join(dir, 'config', 'openapi.ts'), `export default ${openapi}\n`)
    return createApp({ basePath: dir, autoloadRoutes: false })
  }

  const status = async (app: Application): Promise<number> =>
    (await app.handle(new Request('http://localhost/openapi/json'))).status

  for (const env of ['local', 'production']) {
    test(`app.env=${env}: enabled: false wins`, async () => {
      expect(await status(await appWith(env, '{ enabled: false }'))).toBe(404)
    })

    test(`app.env=${env}: enabled: true wins`, async () => {
      expect(await status(await appWith(env, '{ enabled: true }'))).toBe(200)
    })
  }

  test('unset means on — installing the optional peer is the opt-in', async () => {
    expect(await status(await appWith('production', '{}'))).toBe(200)
  })
})
