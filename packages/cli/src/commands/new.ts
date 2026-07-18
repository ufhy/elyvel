import type { KitName } from '../kits'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isKitName, kitNames, kitNextSteps, scaffoldKit } from '../kits'

const templatesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates', 'base')

/** Template basenames that map to dotfiles (can't ship dotfiles cleanly as `.tmpl`). */
const DOTFILES: Record<string, string> = { gitignore: '.gitignore', env: '.env.example' }

/** kebab-case app name + a Title Case display name from arbitrary input. */
function names(raw: string): { name: string, appName: string } {
  const words = raw
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  return {
    name: words.map(w => w.toLowerCase()).join('-') || 'app',
    appName: words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || 'App',
  }
}

/** Map a template path (`config/app.ts.tmpl`) to its output path (`config/app.ts`). */
function outputPath(rel: string): string {
  const withoutTmpl = rel.replace(/\.tmpl$/, '')
  const dir = dirname(withoutTmpl)
  const base = withoutTmpl.slice(dir === '.' ? 0 : dir.length + 1)
  const mapped = DOTFILES[base] ?? base
  return dir === '.' ? mapped : join(dir, mapped)
}

/** Scaffold a new elyvel application skeleton (Laravel's `laravel new`). */
export async function newApp(
  rawName?: string,
  flags: Record<string, string | boolean> = {},
): Promise<number> {
  if (!rawName) {
    console.error('Missing name. Usage: elyvel new <name> [--kit=vue|spa]')
    return 1
  }

  const kit: KitName = typeof flags.kit === 'string' ? (flags.kit as KitName) : 'vue'
  if (typeof flags.kit === 'string' && !isKitName(flags.kit)) {
    console.error(`✗ Unknown kit "${flags.kit}". Available: ${kitNames.join(', ')}`)
    return 1
  }
  if (!existsSync(templatesDir)) {
    console.error(`Template not found: ${templatesDir}`)
    return 1
  }

  const vars = names(rawName)
  const target = join(process.cwd(), rawName)
  if (existsSync(target)) {
    console.error(`✗ Directory already exists: ${relative(process.cwd(), target)}`)
    return 1
  }

  const entries = await readdir(templatesDir, { recursive: true, withFileTypes: true })
  let count = 0
  for (const entry of entries) {
    if (!entry.isFile())
      continue
    const parent = (entry as { parentPath?: string, path?: string }).parentPath ?? templatesDir
    const abs = join(parent, entry.name)
    const rel = relative(templatesDir, abs)
    const template = await readFile(abs, 'utf8')
    const rendered = template.replace(
      /\{\{(\w+)\}\}/g,
      (_, key: string) => (vars as Record<string, string>)[key] ?? '',
    )
    const dest = join(target, outputPath(rel))
    await mkdir(dirname(dest), { recursive: true })
    await Bun.write(dest, rendered)
    count++
  }

  // Create .env from .env.example with a fresh APP_KEY, so the app runs immediately.
  const envExample = join(target, '.env.example')
  if (existsSync(envExample)) {
    const key = `base64:${randomBytes(32).toString('base64')}`
    const content = (await readFile(envExample, 'utf8')).replace(/^APP_KEY=.*$/m, `APP_KEY=${key}`)
    await Bun.write(join(target, '.env'), content)
  }

  console.log(`✓ Created ${vars.appName} in ${rawName}/ (${count} files, .env + APP_KEY set)`)

  // Full-stack by default: apply the selected starter kit (Better Auth + a Vue
  // frontend). Everything comes from the installer — no manual package/file edits.
  await scaffoldKit(kit, target, true)

  console.log('\nNext steps:')
  console.log(`  cd ${rawName}`)
  for (const line of kitNextSteps(kit)) console.log(`  ${line}`)
  return 0
}
