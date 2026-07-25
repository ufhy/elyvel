import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { newApp } from '../src/commands/new'

let dir: string
let cwd: string

beforeEach(() => {
  cwd = process.cwd()
  dir = mkdtempSync(join(tmpdir(), 'elyvel-new-'))
  process.chdir(dir)
})
afterEach(() => {
  process.chdir(cwd)
  rmSync(dir, { recursive: true, force: true })
})

const read = (app: string, rel: string) => readFileSync(join(dir, app, rel), 'utf8')

describe('elyvel new', () => {
  test('scaffolds the base skeleton', async () => {
    expect(await newApp('my-app')).toBe(0)
    for (const f of [
      'package.json',
      'tsconfig.json',
      '.gitignore',
      '.env.example',
      'server.ts',
      'config/app.ts',
      'config/database.ts',
      'config/session.ts',
      'app/providers/AppServiceProvider.ts',
      'routes/web.ts',
      'README.md',
    ]) {
      expect(existsSync(join(dir, 'my-app', f))).toBe(true)
    }
  })

  test('includes the auth kit by default (full-stack)', async () => {
    await newApp('kit-app')
    // auth files scaffolded by the composed installer
    for (const f of [
      'config/auth.ts',
      'config/mail.ts',
      'routes/auth.ts',
      'frontend/Pages/auth/Login.vue',
      'frontend/Pages/Welcome.vue',
      'vite.config.ts',
    ]) {
      expect(existsSync(join(dir, 'kit-app', f))).toBe(true)
    }
    const pkg = JSON.parse(read('kit-app', 'package.json'))
    expect(pkg.dependencies['better-auth']).toBeDefined()
    expect(pkg.dependencies['@elyvel/auth']).toBeDefined()
    // Auth/MailServiceProvider are no longer text-patched into config/app.ts —
    // `elyvel package:discover` (run via postinstall) picks them up instead.
    expect(pkg.scripts.postinstall).toBe('elyvel package:discover')
  })

  test('--kit=none scaffolds the base skeleton without a frontend kit', async () => {
    expect(await newApp('bare-app', { kit: 'none' })).toBe(0)
    for (const f of ['config/app.ts', 'routes/web.ts', 'app/providers/AppServiceProvider.ts']) {
      expect(existsSync(join(dir, 'bare-app', f))).toBe(true)
    }
    for (const f of ['config/auth.ts', 'frontend/Pages/Welcome.vue', 'vite.config.ts']) {
      expect(existsSync(join(dir, 'bare-app', f))).toBe(false)
    }
    const pkg = JSON.parse(read('bare-app', 'package.json'))
    expect(pkg.dependencies['better-auth']).toBeUndefined()
    expect(pkg.dependencies?.vue).toBeUndefined()
  })

  test('creates .env with a generated APP_KEY (ready to run)', async () => {
    await newApp('keyed')
    expect(existsSync(join(dir, 'keyed', '.env'))).toBe(true)
    expect(readFileSync(join(dir, 'keyed', '.env'), 'utf8')).toMatch(/^APP_KEY=base64:.+/m)
  })

  test('substitutes the name (kebab) and appName (Title Case)', async () => {
    await newApp('My Blog')
    const pkg = JSON.parse(read('My Blog', 'package.json'))
    expect(pkg.name).toBe('my-blog')
    expect(read('My Blog', '.env.example')).toContain('APP_NAME="My Blog"')
    expect(read('My Blog', 'README.md')).toContain('# My Blog')
    // no leftover placeholders
    expect(read('My Blog', 'config/app.ts')).not.toContain('{{')
  })

  test('dotfiles are materialized (not .tmpl)', async () => {
    await newApp('app2')
    expect(existsSync(join(dir, 'app2', '.gitignore'))).toBe(true)
    expect(existsSync(join(dir, 'app2', 'gitignore.tmpl'))).toBe(false)
  })

  test('refuses to overwrite an existing directory', async () => {
    expect(await newApp('dupe')).toBe(0)
    expect(await newApp('dupe')).toBe(1)
  })

  test('requires a name', async () => {
    expect(await newApp()).toBe(1)
  })
})
