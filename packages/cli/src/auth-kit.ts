import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const templatesRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates')
const DOTFILES: Record<string, string> = { gitignore: '.gitignore', env: '.env.example' }

/** Packages the auth kit adds to the host app (merged into package.json). */
const AUTH_DEPS: Record<string, string> = {
  '@elysia-ravel/auth': 'workspace:*',
  '@elysia-ravel/inertia': 'workspace:*',
  '@elysia-ravel/mail': 'workspace:*',
  '@elysia-ravel/view': 'workspace:*',
  '@elysia-ravel/vite': 'workspace:*',
  '@inertiajs/vue3': '^3.0.0',
  '@vue/server-renderer': '^3.5.0',
  'better-auth': '^1.6.0',
  vue: '^3.5.0',
}
const AUTH_DEV_DEPS: Record<string, string> = {
  '@tailwindcss/vite': '^4.0.0',
  '@vitejs/plugin-vue': '^6.0.0',
  tailwindcss: '^4.0.0',
  vite: '^8.0.0',
}

function outputPath(rel: string): string {
  const withoutTmpl = rel.replace(/\.tmpl$/, '')
  const dir = dirname(withoutTmpl)
  const base = withoutTmpl.slice(dir === '.' ? 0 : dir.length + 1)
  const mapped = DOTFILES[base] ?? base
  return dir === '.' ? mapped : join(dir, mapped)
}

/** Merge auth deps into the app's package.json (only adding what's missing). */
async function mergePackageJson(cwd: string): Promise<void> {
  const path = join(cwd, 'package.json')
  const pkg = JSON.parse(await readFile(path, 'utf8'))
  pkg.dependencies = { ...AUTH_DEPS, ...pkg.dependencies }
  pkg.devDependencies = { ...AUTH_DEV_DEPS, ...pkg.devDependencies }
  pkg.scripts = { build: 'vite build', 'build:ssr': 'vite build --ssr', ...pkg.scripts }
  await Bun.write(path, `${JSON.stringify(pkg, null, 2)}\n`)
}

/** Register MailServiceProvider in config/app.ts (needed for reset/verify email). */
async function registerMailProvider(cwd: string): Promise<boolean> {
  const path = join(cwd, 'config', 'app.ts')
  if (!existsSync(path)) return false
  let src = await readFile(path, 'utf8')
  if (src.includes('MailServiceProvider')) return true
  const importAnchor = "import { EloquentServiceProvider } from '@elysia-ravel/database'"
  const providerAnchor = 'EloquentServiceProvider,'
  if (!src.includes(importAnchor) || !src.includes(providerAnchor)) return false
  src = src.replace(
    importAnchor,
    `${importAnchor}\nimport { MailServiceProvider } from '@elysia-ravel/mail'`,
  )
  src = src.replace(providerAnchor, `${providerAnchor} MailServiceProvider,`)
  await Bun.write(path, src)
  return true
}

/**
 * Scaffold the auth kit (Better Auth + Inertia/Vue UI) into an app directory.
 * Internal helper composed by `ravel new` — not a standalone CLI command.
 * `quiet` suppresses the trailing "Next steps" (new prints them once).
 */
export async function scaffoldAuthKit(cwd: string = process.cwd(), quiet = false): Promise<number> {
  if (!existsSync(join(cwd, 'config', 'app.ts'))) {
    console.error(
      '✗ Not an elysia-ravel app (no config/app.ts). Run this inside your app directory.',
    )
    return 1
  }

  const templatesDir = join(templatesRoot, 'auth')
  const entries = await readdir(templatesDir, { recursive: true, withFileTypes: true })
  let written = 0
  let skipped = 0
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const parent = (entry as { parentPath?: string; path?: string }).parentPath ?? templatesDir
    const abs = join(parent, entry.name)
    const dest = join(cwd, outputPath(relative(templatesDir, abs)))
    if (existsSync(dest)) {
      console.log(`  skip (exists) ${relative(cwd, dest)}`)
      skipped++
      continue
    }
    await mkdir(dirname(dest), { recursive: true })
    await Bun.write(dest, await readFile(abs, 'utf8'))
    written++
  }

  await mergePackageJson(cwd)
  const providerOk = await registerMailProvider(cwd)

  console.log(`\n✓ Installed auth (${written} files${skipped ? `, ${skipped} skipped` : ''})`)
  if (!providerOk) {
    console.log(
      '  ! Could not auto-register MailServiceProvider — add it to config/app.ts providers:',
    )
    console.log("      import { MailServiceProvider } from '@elysia-ravel/mail'")
  }
  if (!quiet) {
    console.log('\nNext steps:')
    console.log('  bun install')
    console.log('  bun run migrate      # creates the Better Auth tables')
    console.log('  bun run build        # build the Inertia/Vue assets (or `bun run dev` for HMR)')
    console.log('  bun run dev')
  }
  return 0
}
