import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { install } from '../src/commands/install'
import { newApp } from '../src/commands/new'

let dir: string
let cwd: string

beforeEach(() => {
  cwd = process.cwd()
  dir = mkdtempSync(join(tmpdir(), 'ravel-install-'))
  process.chdir(dir)
})
afterEach(() => {
  process.chdir(cwd)
  rmSync(dir, { recursive: true, force: true })
})

const read = (rel: string) => readFileSync(join(dir, 'app1', rel), 'utf8')

describe('ravel install auth', () => {
  test('scaffolds the auth kit into an existing app', async () => {
    await newApp('app1')
    process.chdir(join(dir, 'app1'))
    expect(await install('auth')).toBe(0)

    for (const f of [
      'app/better-auth.ts',
      'config/mail.ts',
      'vite.config.ts',
      'routes/auth.ts',
      'routes/assets.ts',
      'resources/css/app.css',
      'resources/js/app.ts',
      'resources/js/ssr.ts',
      'resources/js/lib/auth.ts',
      'resources/js/Layouts/AppLayout.vue',
      'resources/js/Pages/auth/Login.vue',
      'resources/js/Pages/Dashboard.vue',
      'resources/js/Pages/settings/Password.vue',
      'database/migrations/20260101000001_create_better_auth_tables.ts',
    ]) {
      expect(existsSync(join(dir, 'app1', f))).toBe(true)
    }
  })

  test('merges deps + registers MailServiceProvider', async () => {
    await newApp('app1')
    process.chdir(join(dir, 'app1'))
    await install('auth')

    const pkg = JSON.parse(read('package.json'))
    expect(pkg.dependencies['@elysia-ravel/auth']).toBeDefined()
    expect(pkg.dependencies['better-auth']).toBeDefined()
    expect(pkg.devDependencies.tailwindcss).toBeDefined()
    expect(pkg.scripts.build).toBe('vite build')

    const appConfig = read('config/app.ts')
    expect(appConfig).toContain("import { MailServiceProvider } from '@elysia-ravel/mail'")
    expect(appConfig).toContain('MailServiceProvider,')
  })

  test('is idempotent — skips files that already exist', async () => {
    await newApp('app1')
    process.chdir(join(dir, 'app1'))
    expect(await install('auth')).toBe(0)
    expect(await install('auth')).toBe(0) // second run doesn't clobber, still succeeds
  })

  test('refuses outside an app / unknown feature', async () => {
    expect(await install('auth')).toBe(1) // no config/app.ts here
    await newApp('app1')
    process.chdir(join(dir, 'app1'))
    expect(await install('nope')).toBe(1)
  })
})
