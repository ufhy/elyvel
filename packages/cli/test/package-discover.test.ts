import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { packageDiscoverCommand } from '../src/commands/package-discover'

let dir: string
let cwd: string

beforeEach(() => {
  cwd = process.cwd()
  dir = mkdtempSync(join(tmpdir(), 'elyvel-discover-'))
  process.chdir(dir)
})
afterEach(() => {
  process.chdir(cwd)
  rmSync(dir, { recursive: true, force: true })
})

/** Write a fake `@elyvel/<name>` package under node_modules with the given index.js body. */
function fakePackage(name: string, indexBody: string): void {
  const pkgDir = join(dir, 'node_modules', '@elyvel', name)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: `@elyvel/${name}`, main: 'index.js' }))
  writeFileSync(join(pkgDir, 'index.js'), indexBody)
}

const manifest = () => readFileSync(join(dir, 'bootstrap', 'providers.generated.ts'), 'utf8')

describe('elyvel package:discover', () => {
  test('no @elyvel/* packages installed at all — no-op, exit 0', async () => {
    expect(await packageDiscoverCommand()).toBe(0)
    expect(existsSync(join(dir, 'bootstrap', 'providers.generated.ts'))).toBe(false)
  })

  test('discovers a package exporting elyvelProviders; skips one that does not', async () => {
    fakePackage('has-provider', 'export class HasProviderServiceProvider {}\nexport const elyvelProviders = [HasProviderServiceProvider]\n')
    fakePackage('no-provider', 'export const somethingElse = 1\n')

    expect(await packageDiscoverCommand()).toBe(0)
    const generated = manifest()
    expect(generated).toContain('HasProviderServiceProvider')
    expect(generated).toContain('@elyvel/has-provider')
    expect(generated).not.toContain('no-provider')
    expect(generated).toContain('export const discoveredProviders = [HasProviderServiceProvider]')
  })

  test('always excludes @elyvel/cli itself', async () => {
    fakePackage('cli', 'export const elyvelProviders = [class NotReal {}]\n')
    expect(await packageDiscoverCommand()).toBe(0)
    expect(readFileSync(join(dir, 'bootstrap', 'providers.generated.ts'), 'utf8')).toContain('No discoverable packages found')
  })

  test('honors dontDiscover from config/app.ts', async () => {
    fakePackage('excluded-pkg', 'export class ExcludedServiceProvider {}\nexport const elyvelProviders = [ExcludedServiceProvider]\n')
    fakePackage('kept-pkg', 'export class KeptServiceProvider {}\nexport const elyvelProviders = [KeptServiceProvider]\n')
    mkdirSync(join(dir, 'config'), { recursive: true })
    writeFileSync(
      join(dir, 'config', 'app.ts'),
      `export default { dontDiscover: ['@elyvel/excluded-pkg'] }\n`,
    )

    expect(await packageDiscoverCommand()).toBe(0)
    const generated = manifest()
    expect(generated).toContain('KeptServiceProvider')
    expect(generated).not.toContain('ExcludedServiceProvider')
  })

  test('a package that throws on import fails loudly (exit 1), not silently', async () => {
    fakePackage('broken-pkg', 'throw new Error("boom")\n')
    expect(await packageDiscoverCommand()).toBe(1)
  })
})
