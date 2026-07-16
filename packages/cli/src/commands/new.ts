import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scaffoldAuthKit } from '../auth-kit'

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

/** Scaffold a new elysia-ravel application skeleton (Laravel's `laravel new`). */
export async function newApp(rawName?: string): Promise<number> {
  if (!rawName) {
    console.error('Missing name. Usage: ravel new <name>')
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

  // Full-stack by default: apply the auth kit (Better Auth + Inertia/Vue UI).
  // Everything comes from the installer — no manual package/file edits.
  await scaffoldAuthKit(target, true)

  console.log('\nNext steps:')
  console.log(`  cd ${rawName}`)
  console.log('  bun install')
  console.log('  bun run migrate')
  console.log('  bun run build   # build the Inertia/Vue assets (or `bun run dev` for HMR)')
  console.log('  bun run dev')
  return 0
}
