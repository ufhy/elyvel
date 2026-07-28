import type { Subprocess } from 'bun'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { error } from '../io'

const DEFAULT_ENTRIES = ['server.ts', 'src/server.ts', 'bootstrap/server.ts']
const VITE_CONFIGS = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs']

/** Handle `elyvel serve [--entry path] [--watch] [--no-vite]`. */
export async function serve(flags: Record<string, string | boolean>): Promise<number> {
  const cwd = process.cwd()

  const entry
    = typeof flags.entry === 'string'
      ? join(cwd, flags.entry)
      : DEFAULT_ENTRIES.map(e => join(cwd, e)).find(existsSync)

  if (!entry || !existsSync(entry)) {
    error(
      `Could not find a server entry. Looked for: ${DEFAULT_ENTRIES.join(', ')}.\n`
      + 'Pass one explicitly with --entry <path>.',
    )
    return 1
  }

  // Start the Vite dev server alongside the app when the project has a Vite
  // config (Inertia/Vue apps need it for HMR + to serve client assets). The
  // server injects the dev client automatically. Opt out with `--no-vite`.
  const hasVite = VITE_CONFIGS.some(c => existsSync(join(cwd, c)))
  let vite: Subprocess | null = null
  if (hasVite && flags.vite !== false) {
    vite = Bun.spawn(['bunx', 'vite'], { stdio: ['inherit', 'inherit', 'inherit'] })
  }

  const watch = flags.watch !== false // watch by default
  const args = ['run', ...(watch ? ['--watch'] : []), entry]
  const proc = Bun.spawn(['bun', ...args], { stdio: ['inherit', 'inherit', 'inherit'] })

  const code = await proc.exited
  vite?.kill()
  return code
}
