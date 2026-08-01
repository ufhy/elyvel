import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { createApp } from '../src/application'

let dir: string

afterEach(() => {
  if (dir)
    rmSync(dir, { recursive: true, force: true })
})

function setupApp(appConfig: string): string {
  dir = mkdtempSync(join(tmpdir(), 'elyvel-debug-'))
  mkdirSync(join(dir, 'config'), { recursive: true })
  writeFileSync(join(dir, 'config', 'app.ts'), appConfig)
  return dir
}

/** Renders an uncaught error as a browser would ask for it. */
async function errorPage(base: string): Promise<string> {
  const app = await createApp({ basePath: base, autoloadRoutes: false })
  app.elysia.get('/boom', () => {
    throw new Error('kaboom-marker')
  })
  const res = await app.elysia.handle(
    new Request('http://localhost/boom', { headers: { accept: 'text/html' } }),
  )
  return res.text()
}

/**
 * `app.debug` is obeyed as written. It used to default to on and then be
 * force-disabled whenever `app.env === 'production'` — the framework overriding
 * a value the app had set, with the actual safety coming from a second variable.
 * Laravel reaches the same place without the override, by defaulting to false:
 * `(bool) env('APP_DEBUG', false)`. A deploy that configures nothing leaks
 * nothing; an app that asks for traces gets them where it asked.
 */
describe('app.debug', () => {
  test('defaults to off — an app that configures nothing never leaks a trace', async () => {
    const base = setupApp('export default { name: \'Test\' }\n')
    expect(await errorPage(base)).not.toContain('kaboom-marker')
  })

  for (const env of ['local', 'production']) {
    test(`debug: true is honoured with app.env=${env}`, async () => {
      const base = setupApp(`export default { name: 'Test', env: '${env}', debug: true }\n`)
      expect(await errorPage(base)).toContain('kaboom-marker')
    })
  }

  test('debug: false hides the trace outside production too', async () => {
    const base = setupApp('export default { name: \'Test\', env: \'local\', debug: false }\n')
    expect(await errorPage(base)).not.toContain('kaboom-marker')
  })
})
