import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { createApp } from '../src/application'

let dir: string

afterEach(() => {
  if (dir)
    rmSync(dir, { recursive: true, force: true })
})

function setupApp(appEnv: string, loggingConfig: string): string {
  dir = mkdtempSync(join(tmpdir(), 'elyvel-log-format-'))
  mkdirSync(join(dir, 'config'), { recursive: true })
  writeFileSync(join(dir, 'config', 'app.ts'), `export default { name: 'Test', env: '${appEnv}' }\n`)
  writeFileSync(join(dir, 'config', 'logging.ts'), loggingConfig)
  return dir
}

function firstLine(path: string): string {
  return readFileSync(path, 'utf8').split('\n')[0] ?? ''
}

/**
 * Regression: a log FILE's format used to follow `app.env` — pretty text outside
 * production, JSON inside it. Two consequences, both seen in a real app:
 *
 * 1. Flipping APP_ENV to production part-way through a file's life left one
 *    `app.log` holding both formats. The log viewer picked its parser from the
 *    first line, so 46 of 64 entries silently vanished from the UI.
 * 2. Pretty text cannot carry structured context — `appName=My App` is a string,
 *    not a field — so entries written in dev can't be filtered on their context.
 *
 * A file outlives the environment that produced it. The console still follows the
 * environment: it's ephemeral and read by a person.
 */
describe('log file format does not depend on app.env', () => {
  for (const env of ['local', 'staging', 'production']) {
    test(`app.env=${env} writes JSON to the file`, async () => {
      const base = setupApp(env, 'export default { file: \'app.log\' }\n')
      const app = await createApp({ basePath: base, autoloadRoutes: false })
      app.logger.info('hello', { appName: 'My App' })

      const line = firstLine(join(base, 'app.log'))
      expect(line.startsWith('{')).toBe(true)
      // The context survives as a field — the whole point of not using pretty.
      expect(JSON.parse(line)).toMatchObject({ level: 'info', message: 'hello', appName: 'My App' })
    })
  }

  test('an explicit pretty: true is still honoured, in any environment', async () => {
    const base = setupApp('local', 'export default { file: \'app.log\', pretty: true }\n')
    const app = await createApp({ basePath: base, autoloadRoutes: false })
    app.logger.info('hello')

    expect(firstLine(join(base, 'app.log')).startsWith('{')).toBe(false)
  })

  test('a channel\'s own pretty setting wins over the default', async () => {
    const base = setupApp('local', `
      export default {
        default: 'text',
        channels: { text: { driver: 'file', path: 'app.log', pretty: true } },
      }
    `)
    const app = await createApp({ basePath: base, autoloadRoutes: false })
    app.logger.info('hello')

    expect(firstLine(join(base, 'app.log')).startsWith('{')).toBe(false)
  })
})
