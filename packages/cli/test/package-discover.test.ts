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
const commandsManifest = () => readFileSync(join(dir, 'bootstrap', 'commands.generated.ts'), 'utf8')

describe('elyvel package:discover', () => {
  test('no @elyvel/* packages installed at all — no-op, exit 0', async () => {
    expect(await packageDiscoverCommand()).toBe(0)
    expect(existsSync(join(dir, 'bootstrap', 'providers.generated.ts'))).toBe(false)
    expect(existsSync(join(dir, 'bootstrap', 'commands.generated.ts'))).toBe(false)
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

describe('elyvel package:discover — elyvelCommands', () => {
  test('discovers a package exporting elyvelCommands (no providers needed)', async () => {
    fakePackage(
      'has-commands',
      'export const elyvelCommands = [{ name: "widget:do", description: "does a thing", run: () => 0 }]\n',
    )
    expect(await packageDiscoverCommand()).toBe(0)
    const generated = commandsManifest()
    expect(generated).toContain('@elyvel/has-commands')
    expect(generated).toContain('import { elyvelCommands as commands$0 } from \'@elyvel/has-commands\'')
    expect(generated).toContain('export const discoveredCommands = [...commands$0]')
    // No elyvelProviders exported at all — providers manifest stays empty.
    expect(manifest()).toContain('export const discoveredProviders = []')
  })

  test('a package with both providers and commands appears in both manifests', async () => {
    fakePackage(
      'full-pkg',
      'export class FullServiceProvider {}\n'
      + 'export const elyvelProviders = [FullServiceProvider]\n'
      + 'export const elyvelCommands = [{ name: "full:run", description: "runs", run: () => 0 }]\n',
    )
    expect(await packageDiscoverCommand()).toBe(0)
    expect(manifest()).toContain('FullServiceProvider')
    expect(commandsManifest()).toContain('@elyvel/full-pkg')
  })

  test('a package exporting an empty elyvelCommands array is not discovered', async () => {
    fakePackage('empty-commands', 'export const elyvelCommands = []\n')
    expect(await packageDiscoverCommand()).toBe(0)
    expect(commandsManifest()).toContain('export const discoveredCommands = []')
  })

  test('honors dontDiscover for command-only packages too', async () => {
    fakePackage('excluded-cmds', 'export const elyvelCommands = [{ name: "x:y", description: "d", run: () => 0 }]\n')
    mkdirSync(join(dir, 'config'), { recursive: true })
    writeFileSync(
      join(dir, 'config', 'app.ts'),
      `export default { dontDiscover: ['@elyvel/excluded-cmds'] }\n`,
    )
    expect(await packageDiscoverCommand()).toBe(0)
    expect(commandsManifest()).not.toContain('excluded-cmds')
  })
})
