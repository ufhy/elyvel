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

/**
 * Laravel's `Log::build([...])` and `Log::stack([...])`: a logger described where
 * it's used instead of in `config/logging.ts`. The case that wants it is the
 * one-off sink — an import job's own audit file, a trace opened during an
 * incident — which doesn't deserve a permanent channel, and previously had no
 * route at all short of constructing transports by hand.
 */
describe('on-demand loggers', () => {
  test('build() writes to a channel that was never configured', async () => {
    const base = setupApp(`export default { default: 'stack', ${CHANNELS} }\n`)
    const app = await createApp({ basePath: base, autoloadRoutes: false })

    app.log.build({ driver: 'file', path: 'ondemand.log' }).info('one-off')

    expect(readFileSync(join(base, 'ondemand.log'), 'utf8')).toContain('one-off')
    // Not registered — asking for it by name still fails.
    expect(() => app.channel('ondemand')).toThrow(/is not defined/)
  })

  test('build() inherits redaction from the app config, so a one-off sink can\'t leak', async () => {
    const base = setupApp(`export default { default: 'null', redact: ['password'], ${CHANNELS} }\n`)
    const app = await createApp({ basePath: base, autoloadRoutes: false })

    app.log.build({ driver: 'file', path: 'ondemand.log' }).info('login', { password: 'hunter2' })

    const written = readFileSync(join(base, 'ondemand.log'), 'utf8')
    expect(written).not.toContain('hunter2')
  })

  test('build() honours its own level', async () => {
    const base = setupApp(`export default { default: 'null', ${CHANNELS} }\n`)
    const app = await createApp({ basePath: base, autoloadRoutes: false })

    const audit = app.log.build({ driver: 'file', path: 'audit.log', level: 'error' })
    audit.info('dropped')
    audit.error('kept')

    const written = readFileSync(join(base, 'audit.log'), 'utf8')
    expect(written).toContain('kept')
    expect(written).not.toContain('dropped')
  })

  test('stack() fans one write out to several existing channels', async () => {
    const base = setupApp(`export default { default: 'null', ${CHANNELS} }\n`)
    const app = await createApp({ basePath: base, autoloadRoutes: false })

    app.log.stack(['a', 'b']).warning('both')

    expect(readFileSync(join(base, 'a.log'), 'utf8')).toContain('both')
    expect(readFileSync(join(base, 'b.log'), 'utf8')).toContain('both')
  })

  test('stack() rejects a channel that does not exist, rather than dropping it', async () => {
    const base = setupApp(`export default { default: 'null', ${CHANNELS} }\n`)
    const app = await createApp({ basePath: base, autoloadRoutes: false })

    expect(() => app.log.stack(['a', 'nope'])).toThrow(/is not defined/)
  })
})
