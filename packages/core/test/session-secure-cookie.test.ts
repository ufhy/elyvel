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

function setupApp(appEnv: string, sessionConfig: string): string {
  dir = mkdtempSync(join(tmpdir(), 'elyvel-session-secure-'))
  mkdirSync(join(dir, 'config'), { recursive: true })
  writeFileSync(
    join(dir, 'config', 'app.ts'),
    `export default { name: 'Test', env: '${appEnv}', key: 'base64:test-key' }\n`,
  )
  writeFileSync(join(dir, 'config', 'session.ts'), sessionConfig)
  return dir
}

async function setCookie(base: string): Promise<string> {
  const app = await createApp({ basePath: base, autoloadRoutes: false })
  app.elysia.get('/touch', ({ session }: any) => {
    session.put('k', 'v')
    return 'ok'
  })
  const res = await app.elysia.handle(new Request('http://localhost/touch'))
  return res.headers.get('set-cookie') ?? ''
}

/**
 * `secure` used to default to `app.env === 'production'`. That guess is wrong in
 * both directions and fails silently: a production-labelled app served over plain
 * http sets a Secure cookie the browser then refuses to send back, so every
 * session is empty and nothing anywhere reports an error. Laravel takes it from
 * `env('SESSION_SECURE_COOKIE')` in the app's own config and defaults to off; the
 * framework consults no environment at all.
 */
describe('session cookie Secure flag comes from config, not the environment', () => {
  for (const env of ['local', 'staging', 'production']) {
    test(`app.env=${env} does not set Secure on its own`, async () => {
      const base = setupApp(env, 'export default { driver: \'cookie\' }\n')
      expect(await setCookie(base)).not.toContain('Secure')
    })
  }

  test('secure: true is honoured, in any environment', async () => {
    const base = setupApp('local', 'export default { driver: \'cookie\', secure: true }\n')
    expect(await setCookie(base)).toContain('Secure')
  })

  test('secure: false stays off in production', async () => {
    const base = setupApp('production', 'export default { driver: \'cookie\', secure: false }\n')
    expect(await setCookie(base)).not.toContain('Secure')
  })
})
