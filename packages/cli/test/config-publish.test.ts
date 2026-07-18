import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { configPublish, PUBLISHABLE_CONFIGS } from '../src/commands/config'

let dir: string
let cwd: string

beforeEach(() => {
  cwd = process.cwd()
  dir = mkdtempSync(join(tmpdir(), 'elyvel-config-'))
  process.chdir(dir)
})
afterEach(() => {
  process.chdir(cwd)
  rmSync(dir, { recursive: true, force: true })
})

const read = (rel: string) => readFileSync(join(dir, rel), 'utf8')

describe('config:publish', () => {
  test('with no names, publishes every known config', async () => {
    expect(await configPublish([])).toBe(0)
    for (const name of PUBLISHABLE_CONFIGS) {
      const src = read(`config/${name}.ts`)
      expect(src).toContain('export default define')
    }
  })

  test('publishes only the requested config(s)', async () => {
    expect(await configPublish(['cache'])).toBe(0)
    const src = read('config/cache.ts')
    expect(src).toContain('defineCacheConfig')
  })

  test('rejects an unknown config name', async () => {
    expect(await configPublish(['not-a-real-config'])).toBe(1)
  })

  test('skips an existing file unless --force', async () => {
    await configPublish(['session'])
    const before = read('config/session.ts')

    expect(await configPublish(['session'])).toBe(0) // skipped, not an error
    expect(read('config/session.ts')).toBe(before)

    await configPublish(['session'], { force: true })
    expect(read('config/session.ts')).toBe(before) // same template, but did overwrite
  })

  test('app.ts substitutes {{appName}} from the current directory name', async () => {
    await configPublish(['app'])
    const src = read('config/app.ts')
    expect(src).not.toContain('{{appName}}')
    expect(src).toContain('??')
  })
})
