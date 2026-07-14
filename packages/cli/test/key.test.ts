import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { keyGenerate } from '../src/commands/key'

let dir: string
let cwd: string

beforeEach(() => {
  cwd = process.cwd()
  dir = mkdtempSync(join(tmpdir(), 'ravel-key-'))
  process.chdir(dir)
})
afterEach(() => {
  process.chdir(cwd)
  rmSync(dir, { recursive: true, force: true })
})

const env = () => readFileSync(join(dir, '.env'), 'utf8')

describe('ravel key:generate', () => {
  test('replaces an existing APP_KEY= line', async () => {
    writeFileSync(join(dir, '.env'), 'APP_NAME="X"\nAPP_KEY=\nPORT=3000\n')
    expect(await keyGenerate()).toBe(0)
    expect(env()).toMatch(/^APP_KEY=base64:[A-Za-z0-9+/=]{40,}$/m)
    expect(env()).toContain('APP_NAME="X"') // other lines untouched
    expect(env()).toContain('PORT=3000')
  })

  test('appends APP_KEY when missing', async () => {
    writeFileSync(join(dir, '.env'), 'APP_NAME="X"\n')
    await keyGenerate()
    expect(env()).toMatch(/APP_KEY=base64:/)
    expect(env()).toContain('APP_NAME="X"')
  })

  test('--show prints a key and does NOT write', async () => {
    writeFileSync(join(dir, '.env'), 'APP_KEY=keep-me\n')
    expect(await keyGenerate({ show: true })).toBe(0)
    expect(env()).toBe('APP_KEY=keep-me\n') // unchanged
  })

  test('seeds .env from .env.example when .env is missing', async () => {
    writeFileSync(join(dir, '.env.example'), 'APP_NAME="X"\nAPP_KEY=\n')
    expect(await keyGenerate()).toBe(0)
    expect(existsSync(join(dir, '.env'))).toBe(true)
    expect(env()).toMatch(/APP_KEY=base64:/)
  })

  test('errors when there is neither .env nor .env.example', async () => {
    expect(await keyGenerate()).toBe(1)
  })

  test('generated keys are unique + base64 32 bytes', async () => {
    writeFileSync(join(dir, '.env'), 'APP_KEY=\n')
    await keyGenerate()
    const a = env().match(/APP_KEY=(base64:.+)/)?.[1] ?? ''
    await keyGenerate()
    const b = env().match(/APP_KEY=(base64:.+)/)?.[1] ?? ''
    expect(a).not.toBe(b)
    expect(Buffer.from(a.replace('base64:', ''), 'base64').length).toBe(32)
  })
})
