import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { langPublish } from '../src/commands/lang'

let dir: string
let cwd: string

beforeEach(() => {
  cwd = process.cwd()
  dir = mkdtempSync(join(tmpdir(), 'elyvel-lang-'))
  process.chdir(dir)
})
afterEach(() => {
  process.chdir(cwd)
  rmSync(dir, { recursive: true, force: true })
})

describe('elyvel lang:publish', () => {
  test('publishes validation defaults to lang/vendor/validation/<locale>.ts (namespaced), not lang/<locale>/validation.ts', () => {
    expect(langPublish('en')).toBe(0)
    expect(existsSync(join(dir, 'lang', 'vendor', 'validation', 'en.ts'))).toBe(true)
    expect(existsSync(join(dir, 'lang', 'en', 'validation.ts'))).toBe(false)
    const content = readFileSync(join(dir, 'lang', 'vendor', 'validation', 'en.ts'), 'utf8')
    expect(content).toContain('required:')
  })

  test('publishes core error defaults to lang/vendor/core/<locale>/errors.ts (namespaced — core:: too)', () => {
    expect(langPublish('en')).toBe(0)
    const content = readFileSync(join(dir, 'lang', 'vendor', 'core', 'en', 'errors.ts'), 'utf8')
    expect(content).toContain('not_found:')
    // auth-specific keys live in @elyvel/auth's own namespace, not core's
    expect(content).not.toContain('unauthenticated')
  })

  test('existing files are left alone unless --force', () => {
    const errorsFile = join(dir, 'lang', 'vendor', 'core', 'en', 'errors.ts')
    langPublish('en')
    writeFileSync(errorsFile, 'export default { custom: true }\n')
    langPublish('en')
    expect(readFileSync(errorsFile, 'utf8')).toContain('custom: true')
    langPublish('en', { force: true })
    expect(readFileSync(errorsFile, 'utf8')).not.toContain('custom: true')
  })

  test('--package=<name> copies an installed package\'s lang/ tree to lang/vendor/<name>/', () => {
    const pkgLangDir = join(dir, 'node_modules', '@elyvel', 'fakepkg', 'lang', 'id')
    mkdirSync(pkgLangDir, { recursive: true })
    writeFileSync(join(pkgLangDir, '..', 'id.ts'), 'export default { hello: "hi" }\n')

    expect(langPublish('en', { package: 'fakepkg' })).toBe(0)
    expect(existsSync(join(dir, 'lang', 'vendor', 'fakepkg', 'id.ts'))).toBe(true)
  })

  test('--package=<name> for a package with no lang/ directory fails loudly (exit 1)', () => {
    mkdirSync(join(dir, 'node_modules', '@elyvel', 'no-lang-pkg'), { recursive: true })
    expect(langPublish('en', { package: 'no-lang-pkg' })).toBe(1)
  })
})
