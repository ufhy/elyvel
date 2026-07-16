import { existsSync } from 'node:fs'
import { join } from 'node:path'

const DEFAULT_ENTRIES = ['server.ts', 'src/server.ts', 'bootstrap/server.ts']

/** Handle `ravel serve [--entry path] [--watch]`. */
export async function serve(flags: Record<string, string | boolean>): Promise<number> {
  const cwd = process.cwd()

  const entry
    = typeof flags.entry === 'string'
      ? join(cwd, flags.entry)
      : DEFAULT_ENTRIES.map(e => join(cwd, e)).find(existsSync)

  if (!entry || !existsSync(entry)) {
    console.error(
      `Could not find a server entry. Looked for: ${DEFAULT_ENTRIES.join(', ')}.\n`
      + 'Pass one explicitly with --entry <path>.',
    )
    return 1
  }

  const watch = flags.watch !== false // watch by default
  const args = ['run', ...(watch ? ['--watch'] : []), entry]

  const proc = Bun.spawn(['bun', ...args], { stdio: ['inherit', 'inherit', 'inherit'] })
  return await proc.exited
}
