import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every @elyvel package the app has installed, read straight off
 * node_modules — its own module (pure `node:fs`) so the main entry and the
 * guideline composer never drag the MCP tool graph in with it.
 */
export function installedElyvelPackages(cwd: string): Array<{ name: string, version: string }> {
  const scopeDir = join(cwd, 'node_modules', '@elyvel')
  if (!existsSync(scopeDir))
    return []
  const found: Array<{ name: string, version: string }> = []
  for (const entry of readdirSync(scopeDir)) {
    try {
      const pkg = JSON.parse(readFileSync(join(scopeDir, entry, 'package.json'), 'utf8')) as {
        name?: string
        version?: string
      }
      found.push({ name: pkg.name ?? `@elyvel/${entry}`, version: pkg.version ?? '(unknown)' })
    }
    catch {
      // an unreadable directory under the scope isn't a package — skip it
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name))
}
