#!/usr/bin/env bun
import type { ConsoleCommand } from '@elyvel/core'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { broadcastServeCommand } from './commands/broadcast'
import { configPublish } from './commands/config'
import { keyGenerate } from './commands/key'
import { langPublish } from './commands/lang'
import { down, up } from './commands/maintenance'
import { generateMigrationPluginCommand, make } from './commands/make'
import { newApp } from './commands/new'
import { packageDiscoverCommand } from './commands/package-discover'
import { routeListCommand } from './commands/route'
import { serve } from './commands/serve'
import { error, line } from './io'

/**
 * Commands contributed by installed `@elyvel/*` packages (queue, database,
 * scheduler, ...) via `elyvelCommands` — written by `elyvel package:discover`.
 * Missing file (discovery never run, or nothing discoverable installed) is
 * NOT an error: the CLI's own built-ins still work without it.
 */
async function loadDiscoveredCommands(): Promise<ConsoleCommand[]> {
  const manifestPath = join(process.cwd(), 'bootstrap', 'commands.generated.ts')
  if (!existsSync(manifestPath))
    return []
  const manifest = (await import(manifestPath)) as { discoveredCommands?: ConsoleCommand[] }
  return manifest.discoveredCommands ?? []
}

const BANNER = `
elyvel — the elyvel CLI

Usage:
  elyvel new <name>                            Scaffold a new elyvel app
  elyvel key:generate [--show] [--force]       Set APP_KEY in .env (--show prints; --force overwrites in prod)
  elyvel serve [--entry <path>] [--no-watch]   Start the dev server
  elyvel lang:publish [locale] [--force]       Publish default messages to lang/<locale> (default en)
  elyvel lang:publish --package=<name> [--force]  Copy an installed package's lang/ to lang/vendor/<name>

  elyvel route:list                            List all registered HTTP routes
  elyvel broadcast:serve [--port=<n>]           Run the WebSocket/broadcast layer as its own process

  elyvel make:controller <Name> [--resource] [--invokable] [--singleton [--creatable]]
                                [--model=X] [--parent=X] [--requests] [--force]
                                                Generate a controller (default: 5-action JSON;
                                                --resource: 7-action w/ create/edit; --invokable: single-action;
                                                --singleton: no-id resource; --requests: + Store/Update FormRequests)
  elyvel make:middleware <Name>                Generate a middleware plugin
  elyvel make:model <Name> [--migration] [--factory] [--seed] [--controller] [--all]
                                                Generate a model + table schema
                                                (companions: migration/factory/seeder/controller)
  elyvel make:migration <name>                 Generate a migration
  elyvel auth:generate-migration-plugin        Generate a migration that re-runs migrateBetterAuth (after enabling a new plugin by hand)
  elyvel make:concern <Name>                   Generate a model concern (Laravel trait equivalent)
  elyvel make:seeder <Name>                    Generate a seeder
  elyvel make:factory <Name>                   Generate a model factory (Faker)
  elyvel make:policy <Name> [--model[=Model]]  Generate an authorization policy
  elyvel make:request <Name>                   Generate a Form Request
  elyvel make:resource <Name>                  Generate an API Resource transform
  elyvel make:event <Name>                     Generate an event class
  elyvel make:listener <Name>                  Generate an event listener
  elyvel make:notification <Name>              Generate a notification
  elyvel make:job <Name>                       Generate a queue job
  elyvel make:provider <Name>                  Generate a service provider

  elyvel config:publish [name...] [--force]    Publish default config files to config/
  elyvel package:discover                      Auto-register installed packages' providers + commands
                                                (bootstrap/providers.generated.ts, bootstrap/commands.generated.ts)
`

/**
 * Package-contributed commands (queue:*, migrate*, db*, schedule:*, model:*,
 * or a third-party package's own) aren't in the static BANNER above — they
 * only exist once the corresponding package is installed. List whatever
 * `package:discover` actually found instead.
 */
function formatDiscoveredCommands(commands: ConsoleCommand[]): string {
  if (commands.length === 0)
    return ''
  const width = Math.max(...commands.map(c => `${c.name} ${c.usage ?? ''}`.trim().length))
  const lines = commands
    .map(c => `  elyvel ${`${c.name} ${c.usage ?? ''}`.trim().padEnd(width)}  ${c.description}`)
    .join('\n')
  return `\nDiscovered package commands (elyvel package:discover):\n${lines}\n`
}

/** Split argv into positionals and `--flag[=value]` pairs. */
export function parseArgs(argv: string[]) {
  const positionals: string[] = []
  const flags: Record<string, string | boolean> = {}

  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [rawKey = '', value] = arg.slice(2).split('=')
      const key = rawKey.startsWith('no-') ? rawKey.slice(3) : rawKey
      flags[key] = value ?? !rawKey.startsWith('no-')
    }
    else {
      positionals.push(arg)
    }
  }

  return { positionals, flags }
}

async function main(): Promise<number> {
  const { positionals, flags } = parseArgs(process.argv.slice(2))
  const [command, ...rest] = positionals

  if (!command || command === 'help' || flags.help) {
    line(BANNER)
    line(formatDiscoveredCommands(await loadDiscoveredCommands()))
    return command ? 0 : 1
  }

  if (command === 'new') {
    return newApp(rest[0], flags)
  }

  if (command === 'key:generate') {
    return keyGenerate(flags)
  }

  if (command === 'serve') {
    return serve(flags)
  }

  if (command === 'down') {
    return down(flags)
  }

  if (command === 'up') {
    return up()
  }

  if (command === 'lang:publish') {
    return langPublish(rest[0], flags)
  }

  if (command === 'config:publish') {
    return configPublish(rest, flags)
  }

  if (command === 'package:discover') {
    return packageDiscoverCommand()
  }

  if (command === 'auth:generate-migration-plugin') {
    return generateMigrationPluginCommand()
  }

  if (command === 'route:list') {
    return routeListCommand()
  }

  if (command === 'broadcast:serve') {
    return broadcastServeCommand(flags)
  }

  if (command.startsWith('make:')) {
    return make(command.slice('make:'.length), rest[0], flags)
  }

  // Anything else (queue:*, migrate*, db*, schedule:*, model:*, or a
  // third-party package's own commands) is dispatched from whatever
  // `elyvel package:discover` found — see `loadDiscoveredCommands`.
  const discovered = await loadDiscoveredCommands()
  const match = discovered.find(c => c.name === command)
  if (match)
    return match.run(flags, rest)

  error(`Unknown command "${command}".`)
  if (discovered.length === 0) {
    error(
      'No package commands were discovered — if you expected one (e.g. queue:work), '
      + 'run `elyvel package:discover` first.',
    )
  }
  line(BANNER)
  line(formatDiscoveredCommands(discovered))
  return 1
}

// Re-export the scaffold API so wrappers (e.g. the `create-elyvel` launcher for
// `bun create elyvel`) reuse the exact same logic and bundled templates.
export { newApp } from './commands/new'

// I/O helpers for writing your own commands (`elyvel make:command` — see
// `app/commands/`): colored output, tables, progress bars, interactive
// prompts. Safe to import here since `@elyvel/cli` is already a scaffolded
// app's own devDependency and is never imported by the running server.
export {
  ask,
  choice,
  comment,
  confirm,
  error,
  info,
  line,
  newLine,
  progressBar,
  type ProgressBar,
  type PromptStreams,
  secret,
  table,
  warn,
  withProgressBar,
} from './io'

// Only run the CLI when executed as the entry point — importing this module
// (for the exports above) must not run `main()` / exit the process.
if (import.meta.main)
  process.exit(await main())
