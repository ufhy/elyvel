import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { createApp } from '../src/application'

let dir: string

afterEach(() => {
  if (dir)
    rmSync(dir, { recursive: true, force: true })
})

function setupApp(loggingConfig: string): string {
  dir = mkdtempSync(join(tmpdir(), 'elyvel-log-channels-'))
  mkdirSync(join(dir, 'config'), { recursive: true })
  writeFileSync(join(dir, 'config', 'app.ts'), 'export default { name: \'Test\' }\n')
  writeFileSync(join(dir, 'config', 'logging.ts'), loggingConfig)
  return dir
}

const CHANNELS = `
  channels: {
    stack: { driver: 'stack', channels: ['a', 'b'] },
    a: { driver: 'file', path: 'a.log' },
    b: { driver: 'file', path: 'b.log' },
    null: { driver: 'null' },
  },
`

/**
 * Laravel's `null` channel is a Monolog NullHandler: it exists, accepts writes,
 * and drops them. It's what `LOG_CHANNEL=null` points at to silence logging
 * without deleting the configuration that documents where logs would go — and
 * what `deprecations.channel` defaults to.
 */
describe('the null driver', () => {
  test('accepts writes and drops them', async () => {
    const base = setupApp(`export default { default: 'null', ${CHANNELS} }\n`)
    const app = await createApp({ basePath: base, autoloadRoutes: false })

    expect(() => app.logger.error('vanishes')).not.toThrow()
    expect(existsSync(join(base, 'a.log'))).toBe(false)
    expect(existsSync(join(base, 'b.log'))).toBe(false)
  })

  test('inside a stack it contributes nothing, and the siblings still write', async () => {
    const base = setupApp(`
      export default {
        default: 'stack',
        channels: {
          stack: { driver: 'stack', channels: ['null', 'a'] },
          a: { driver: 'file', path: 'a.log' },
          null: { driver: 'null' },
        },
      }
    `)
    const app = await createApp({ basePath: base, autoloadRoutes: false })
    app.logger.info('kept')

    expect(readFileSync(join(base, 'a.log'), 'utf8')).toContain('kept')
  })

  test('is still reachable by name, so app.channel(\'null\') is not an error', async () => {
    const base = setupApp(`export default { default: 'stack', ${CHANNELS} }\n`)
    const app = await createApp({ basePath: base, autoloadRoutes: false })

    expect(() => app.channel('null').emergency('vanishes')).not.toThrow()
    expect(existsSync(join(base, 'a.log'))).toBe(false)
  })
})

/**
 * `default` picks which channel `app.logger` writes to — Laravel takes it from
 * `env('LOG_CHANNEL', 'stack')` in the app's own config. The framework only reads
 * the config value; the scaffolded `config/logging.ts` is what consults the
 * environment.
 */
describe('the default channel', () => {
  test('names one channel', async () => {
    const base = setupApp(`export default { default: 'b', ${CHANNELS} }\n`)
    const app = await createApp({ basePath: base, autoloadRoutes: false })
    app.logger.info('only b')

    expect(readFileSync(join(base, 'b.log'), 'utf8')).toContain('only b')
    expect(existsSync(join(base, 'a.log'))).toBe(false)
  })

  test('a stack fans out to everything it lists', async () => {
    const base = setupApp(`export default { default: 'stack', ${CHANNELS} }\n`)
    const app = await createApp({ basePath: base, autoloadRoutes: false })
    app.logger.info('both')

    expect(readFileSync(join(base, 'a.log'), 'utf8')).toContain('both')
    expect(readFileSync(join(base, 'b.log'), 'utf8')).toContain('both')
  })
})
