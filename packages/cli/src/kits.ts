import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const templatesRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates')
const DOTFILES: Record<string, string> = { gitignore: '.gitignore', env: '.env.example' }

/** Starter kits selectable via `elyvel new <name> --kit=<name>`. `none` skips kit installation — base template only, no frontend. */
export type KitName = 'vue' | 'spa' | 'none'

interface Kit {
  /** Sub-directory under templates/. */
  dir: string
  /** Human label for logs. */
  label: string
  /** Packages merged into dependencies. */
  deps: Record<string, string>
  /** Packages merged into devDependencies. */
  devDeps: Record<string, string>
  /** npm scripts merged in (build steps differ per kit). */
  scripts: Record<string, string>
  /** Files the kit overwrites even if they already exist. */
  overrides: Set<string>
  /** Trailing "Next steps" lines. */
  nextSteps: string[]
}

// Shared by every Vue-based kit (shadcn-vue + Better Auth UI foundation).
const SHARED_DEPS: Record<string, string> = {
  '@elyvel/auth': 'workspace:*',
  '@elyvel/mail': 'workspace:*',
  '@elyvel/vite': 'workspace:*',
  '@lucide/vue': '^1.17.0',
  '@vueuse/core': '^12.8.2',
  'better-auth': '^1.6.0',
  'class-variance-authority': '^0.7.1',
  'clsx': '^2.1.1',
  'qrcode': '^1.5.4',
  'reka-ui': '^2.9.8',
  'tailwind-merge': '^3.2.0',
  'tw-animate-css': '^1.2.5',
  'vue': '^3.5.0',
}
const SHARED_DEV_DEPS: Record<string, string> = {
  '@tailwindcss/vite': '^4.0.0',
  '@types/qrcode': '^1.5.5',
  '@vitejs/plugin-vue': '^6.0.0',
  'tailwindcss': '^4.0.0',
  'vite': '^8.0.0',
}

const KITS: Record<Exclude<KitName, 'none'>, Kit> = {
  vue: {
    dir: 'auth',
    label: 'Vue + Inertia',
    deps: {
      ...SHARED_DEPS,
      '@elyvel/inertia': 'workspace:*',
      '@elyvel/view': 'workspace:*',
      '@inertiajs/vue3': '^3.0.0',
      '@vue/server-renderer': '^3.5.0',
    },
    devDeps: { ...SHARED_DEV_DEPS },
    scripts: { 'build': 'vite build', 'build:ssr': 'vite build --ssr' },
    overrides: new Set(['routes/web.ts']),
    nextSteps: [
      'bun install',
      'bun run migrate      # creates the Better Auth tables',
      'bun run build        # build the Inertia/Vue assets (or `bun run dev` for HMR)',
      'bun run dev',
    ],
  },
  spa: {
    dir: 'spa',
    label: 'Vue SPA (Vite, no Inertia)',
    deps: { ...SHARED_DEPS, 'vue-router': '^4.5.0' },
    devDeps: { ...SHARED_DEV_DEPS },
    scripts: { build: 'vite build' },
    overrides: new Set(['routes/web.ts']),
    nextSteps: [
      'bun install',
      'bun run migrate      # creates the Better Auth tables',
      'bun run build        # build the SPA assets (or `bun run dev` for HMR)',
      'bun run dev',
    ],
  },
}

const NONE_NEXT_STEPS = ['bun install', 'bun run migrate', 'bun run dev']

export function isKitName(value: string): value is KitName {
  return value === 'none' || value in KITS
}

export const kitNames = [...(Object.keys(KITS) as KitName[]), 'none'] as KitName[]

/** The "Next steps" lines for a kit (printed once by `elyvel new`). `none` has no frontend to build. */
export function kitNextSteps(kitName: KitName): string[] {
  return kitName === 'none' ? NONE_NEXT_STEPS : KITS[kitName].nextSteps
}

function outputPath(rel: string): string {
  const withoutTmpl = rel.replace(/\.tmpl$/, '')
  const dir = dirname(withoutTmpl)
  const base = withoutTmpl.slice(dir === '.' ? 0 : dir.length + 1)
  const mapped = DOTFILES[base] ?? base
  return dir === '.' ? mapped : join(dir, mapped)
}

/** Merge a kit's deps/devDeps/scripts into the app's package.json (missing only). */
async function mergePackageJson(cwd: string, kit: Kit): Promise<void> {
  const path = join(cwd, 'package.json')
  const pkg = JSON.parse(await readFile(path, 'utf8'))
  pkg.dependencies = { ...kit.deps, ...pkg.dependencies }
  pkg.devDependencies = { ...kit.devDeps, ...pkg.devDependencies }
  pkg.scripts = { ...kit.scripts, ...pkg.scripts }
  await Bun.write(path, `${JSON.stringify(pkg, null, 2)}\n`)
}

/**
 * Scaffold a starter kit into an app directory (Better Auth backend + a Vue
 * frontend — Inertia for `vue`, a Vite SPA for `spa`). Composed by `elyvel new`.
 * `quiet` suppresses the trailing "Next steps" (new prints them once).
 */
export async function scaffoldKit(
  kitName: Exclude<KitName, 'none'>,
  cwd: string = process.cwd(),
  quiet = false,
): Promise<number> {
  if (!existsSync(join(cwd, 'config', 'app.ts'))) {
    console.error(
      '✗ Not an elyvel app (no config/app.ts). Run this inside your app directory.',
    )
    return 1
  }

  const kit = KITS[kitName]
  const templatesDir = join(templatesRoot, kit.dir)
  const entries = await readdir(templatesDir, { recursive: true, withFileTypes: true })
  let written = 0
  let skipped = 0
  for (const entry of entries) {
    if (!entry.isFile())
      continue
    const parent = (entry as { parentPath?: string, path?: string }).parentPath ?? templatesDir
    const abs = join(parent, entry.name)
    const rel = outputPath(relative(templatesDir, abs))
    const dest = join(cwd, rel)
    // The full-stack kit's web routes supersede the base health-only stub, so
    // web.ts is overwritten; every other file is left untouched if it exists.
    if (existsSync(dest) && !kit.overrides.has(rel)) {
      console.log(`  skip (exists) ${relative(cwd, dest)}`)
      skipped++
      continue
    }
    await mkdir(dirname(dest), { recursive: true })
    await Bun.write(dest, await readFile(abs, 'utf8'))
    written++
  }

  await mergePackageJson(cwd, kit)

  console.log(`\n✓ Installed ${kit.label} kit (${written} files${skipped ? `, ${skipped} skipped` : ''})`)
  console.log('  Auth/Mail providers are auto-registered by `elyvel package:discover` (runs on `bun install`).')
  if (!quiet) {
    console.log('\nNext steps:')
    for (const line of kit.nextSteps) console.log(`  ${line}`)
  }
  return 0
}
