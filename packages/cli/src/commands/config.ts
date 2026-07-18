import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const templatesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates', 'config')

/** Every config namespace publishable via `elyvel config:publish`. */
export const PUBLISHABLE_CONFIGS = [
  'app',
  'database',
  'i18n',
  'openapi',
  'session',
  'cache',
  'mail',
  'queue',
  'storage',
  'broadcasting',
  'telegram',
] as const

/** A Title Case guess at the app name, from the current directory (used by `app.ts`'s `{{appName}}`). */
function guessAppName(): string {
  const words = basename(process.cwd())
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  return words.length > 0 ? words.map(w => w[0]!.toUpperCase() + w.slice(1)).join(' ') : 'App'
}

/**
 * `elyvel config:publish [name...] [--force]` — copy the framework's default
 * config files into `config/`, the same idea as `lang:publish` but for code
 * instead of message data. With no names, publishes every known config.
 * Existing files are left alone unless `--force`.
 */
export async function configPublish(
  names: string[],
  flags: Record<string, string | boolean> = {},
): Promise<number> {
  const force = flags.force === true
  const targets = names.length > 0 ? names : [...PUBLISHABLE_CONFIGS]
  const unknown = targets.filter(n => !(PUBLISHABLE_CONFIGS as readonly string[]).includes(n))
  if (unknown.length > 0) {
    console.error(
      `Unknown config(s): ${unknown.join(', ')}. Available: ${PUBLISHABLE_CONFIGS.join(', ')}`,
    )
    return 1
  }

  const dir = join(process.cwd(), 'config')
  await mkdir(dir, { recursive: true })
  console.log(`Publishing config files to config/`)

  const appName = guessAppName()
  for (const name of targets) {
    const dest = join(dir, `${name}.ts`)
    const rel = relative(process.cwd(), dest)
    if (existsSync(dest) && !force) {
      console.log(`  • skipped ${rel} (exists — use --force)`)
      continue
    }
    const template = await Bun.file(join(templatesDir, `${name}.ts.tmpl`)).text()
    const rendered = template.replace(/\{\{appName\}\}/g, appName)
    await Bun.write(dest, rendered)
    console.log(`  ✓ ${rel}`)
  }
  console.log(`\nDone. Edit config/*.ts to change defaults — register any new provider in config/app.ts.`)
  return 0
}
