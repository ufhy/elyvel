import type { SessionStore } from '../src/session'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { createApp, registerLogDriver } from '../src/application'
import { registerSessionDriver, sessionDriverNames } from '../src/session'

let dir: string

afterEach(() => {
  if (dir)
    rmSync(dir, { recursive: true, force: true })
})

function setupApp(configs: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), 'elyvel-extend-'))
  mkdirSync(join(dir, 'config'), { recursive: true })
  writeFileSync(join(dir, 'config', 'app.ts'), 'export default { name: \'Test\', key: \'base64:k\' }\n')
  for (const [name, body] of Object.entries(configs))
    writeFileSync(join(dir, 'config', `${name}.ts`), body)
  return dir
}

/**
 * Both of these used to be a `switch`: `SessionStore` and `Transport` were public
 * interfaces you could implement but never name in config. Laravel exposes the
 * same thing as `Session::extend()` and `Log::extend()`.
 */
describe('registerSessionDriver', () => {
  test('a driver the framework never shipped becomes configurable', async () => {
    const writes: string[] = []
    const store: SessionStore = {
      read: async () => ({}),
      write: async (id: string) => void writes.push(id),
      destroy: async () => {},
      gc: async () => {},
    }
    registerSessionDriver('dynamodb', () => store)

    const base = setupApp({ session: 'export default { driver: \'dynamodb\' }\n' })
    const app = await createApp({ basePath: base, autoloadRoutes: false })
    app.elysia.get('/touch', ({ session }: any) => {
      session.put('k', 'v')
      return 'ok'
    })
    await app.elysia.handle(new Request('http://localhost/touch'))

    expect(writes).toHaveLength(1)
  })

  test('the registered name shows up in the list of drivers', () => {
    registerSessionDriver('dynamodb', () => null)
    expect(sessionDriverNames()).toContain('dynamodb')
    expect(sessionDriverNames()).toContain('cookie')
  })

  test('an unknown driver names the ones that exist instead of failing quietly', async () => {
    const base = setupApp({ session: 'export default { driver: \'carrier-pigeon\' }\n' })
    expect(createApp({ basePath: base, autoloadRoutes: false }))
      .rejects
      .toThrow(/Session driver "carrier-pigeon" is not supported/)
  })
})

describe('registerLogDriver', () => {
  test('a custom channel driver receives the config and the app path resolver', async () => {
    const lines: string[] = []
    let resolvedPath = ''
    registerLogDriver('collector', ({ config, path }) => {
      resolvedPath = path((config as { path?: string }).path ?? '')
      return [{ log: entry => void lines.push(`${entry.level}:${entry.message}`) }]
    })

    const base = setupApp({
      logging: `export default {
        default: 'collector',
        channels: { collector: { driver: 'collector', path: 'storage/x.log' } },
      }\n`,
    })
    const app = await createApp({ basePath: base, autoloadRoutes: false })
    app.logger.critical('provider down')

    expect(lines).toContain('critical:provider down')
    expect(resolvedPath).toBe(join(base, 'storage/x.log'))
  })

  test('the built-ins still work alongside it', async () => {
    registerLogDriver('collector', () => [])
    const base = setupApp({
      logging: `export default {
        default: 'file',
        channels: { file: { driver: 'file', path: 'app.log' } },
      }\n`,
    })
    const app = await createApp({ basePath: base, autoloadRoutes: false })
    app.logger.info('still here')

    expect(readFileSync(join(base, 'app.log'), 'utf8')).toContain('still here')
  })
})
