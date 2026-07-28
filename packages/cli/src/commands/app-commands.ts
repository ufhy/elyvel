import type { ConsoleCommand } from '@elyvel/core'
import { join } from 'node:path'
import { warn } from '../io'

interface CommandModule { default?: ConsoleCommand }

function isConsoleCommand(value: unknown): value is ConsoleCommand {
  return typeof value === 'object' && value !== null
    && typeof (value as ConsoleCommand).name === 'string'
    && typeof (value as ConsoleCommand).description === 'string'
    && typeof (value as ConsoleCommand).run === 'function'
}

/**
 * Discover every `*.ts`/`*.js` file under `app/commands/` (an app's own
 * custom commands, scaffolded by `elyvel make:command`) and return the
 * `ConsoleCommand`s they default-export — the same convention `loadRoutes()`
 * uses for `routes/` (default export, stable sorted order, non-conforming
 * files skipped with a warning rather than a fatal error).
 */
export async function loadAppCommands(dir: string): Promise<ConsoleCommand[]> {
  const glob = new Bun.Glob('**/*.{ts,js}')
  const files: string[] = []

  for await (const file of glob.scan({ cwd: dir, onlyFiles: true })) {
    if (file.endsWith('.d.ts') || file.endsWith('.test.ts'))
      continue
    files.push(file)
  }

  files.sort()

  const commands: ConsoleCommand[] = []
  for (const file of files) {
    const absolute = join(dir, file)
    const module = (await import(absolute)) as CommandModule

    if (isConsoleCommand(module.default)) {
      commands.push(module.default)
    }
    else {
      warn(`[elyvel] "${file}" was skipped: expected a default-exported ConsoleCommand.`)
    }
  }

  return commands
}
