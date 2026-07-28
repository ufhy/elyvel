import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { createApp } from '../src/application'
import { LogManagerToken } from '../src/logger'

let dir: string

afterEach(() => {
  if (dir)
    rmSync(dir, { recursive: true, force: true })
})

function setupApp(loggingConfig: string): string {
  dir = mkdtempSync(join(tmpdir(), 'elyvel-logging-stack-'))
  mkdirSync(join(dir, 'config'), { recursive: true })
  writeFileSync(join(dir, 'config', 'app.ts'), 'export default { name: \'Test\' }\n')
  writeFileSync(join(dir, 'config', 'logging.ts'), loggingConfig)
  return dir
}

describe('registerLogger — stack driver (config/logging.ts → channels)', () => {
  test('a stack channel fans a single log call out to every constituent channel', async () => {
    const base = setupApp(`
      export default {
        default: 'everything',
        channels: {
          file_a: { driver: 'file', path: 'a.log' },
          file_b: { driver: 'file', path: 'b.log' },
          everything: { driver: 'stack', channels: ['file_a', 'file_b'] },
        },
      }
    `)

    const app = await createApp({ basePath: base, autoloadRoutes: false })
    app.logger.info('fan-out message')

    expect(readFileSync(join(base, 'a.log'), 'utf8')).toContain('fan-out message')
    expect(readFileSync(join(base, 'b.log'), 'utf8')).toContain('fan-out message')
  })

  test('individual channels are still reachable directly via the LogManager', async () => {
    const base = setupApp(`
      export default {
        default: 'everything',
        channels: {
          file_a: { driver: 'file', path: 'a.log' },
          file_b: { driver: 'file', path: 'b.log' },
          everything: { driver: 'stack', channels: ['file_a', 'file_b'] },
        },
      }
    `)

    const app = await createApp({ basePath: base, autoloadRoutes: false })
    const manager = app.make(LogManagerToken)
    manager.channel('file_a').warn('only in a')
    manager.channel('file_b').warn('only in b')

    expect(readFileSync(join(base, 'a.log'), 'utf8')).toContain('only in a')
    expect(readFileSync(join(base, 'a.log'), 'utf8')).not.toContain('only in b')
    expect(readFileSync(join(base, 'b.log'), 'utf8')).toContain('only in b')
    expect(readFileSync(join(base, 'b.log'), 'utf8')).not.toContain('only in a')
  })

  test('a channel-specific level filters that channel even when logged through the stack', async () => {
    const base = setupApp(`
      export default {
        level: 'info',
        default: 'file_a',
        channels: {
          file_a: { driver: 'file', path: 'a.log', level: 'error' },
        },
      }
    `)

    const app = await createApp({ basePath: base, autoloadRoutes: false })
    app.logger.info('below the channel\'s own level')
    app.logger.error('at the channel\'s own level')

    const contents = readFileSync(join(base, 'a.log'), 'utf8')
    expect(contents).not.toContain('below the channel\'s own level')
    expect(contents).toContain('at the channel\'s own level')
  })
})
