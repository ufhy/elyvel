#!/usr/bin/env bun
import { broadcastServeCommand } from './commands/broadcast'
import { configPublish } from './commands/config'
import {
  dbMonitorCommand,
  dbShellCommand,
  dbShowCommand,
  dbTableCommand,
  migrateCommand,
  pruneCommand,
  rollbackCommand,
  seedCommand,
  statusCommand,
  unlockCommand,
} from './commands/db'
import { keyGenerate } from './commands/key'
import { langPublish } from './commands/lang'
import { down, up } from './commands/maintenance'
import { make } from './commands/make'
import { modelSyncCommand } from './commands/model-sync'
import { newApp } from './commands/new'
import { packageDiscoverCommand } from './commands/package-discover'
import {
  queueFailedCommand,
  queueFlushCommand,
  queueForgetCommand,
  queuePruneFailedCommand,
  queueRestartCommand,
  queueRetryCommand,
  queueWorkCommand,
} from './commands/queue'
import { routeListCommand } from './commands/route'
import {
  scheduleListCommand,
  scheduleRunCommand,
  scheduleTestCommand,
  scheduleWorkCommand,
} from './commands/schedule'
import { serve } from './commands/serve'

const BANNER = `
elyvel — the elyvel CLI

Usage:
  elyvel new <name>                            Scaffold a new elyvel app
  elyvel key:generate [--show] [--force]       Set APP_KEY in .env (--show prints; --force overwrites in prod)
  elyvel serve [--entry <path>] [--no-watch]   Start the dev server
  elyvel lang:publish [locale] [--force]       Publish default messages to lang/<locale> (default en)
  elyvel lang:publish --package=<name> [--force]  Copy an installed package's lang/ to lang/vendor/<name>

  elyvel migrate                               Run pending migrations
  elyvel migrate:fresh                         Drop all tables and re-migrate
  elyvel migrate:rollback                      Roll back the last migration batch
  elyvel migrate:status                        Show applied/pending migrations
  elyvel migrate:unlock                        Force-clear a stuck migration lock (crashed process)
  elyvel db:seed                               Run database/seeders/DatabaseSeeder
  elyvel model:prune [Name]                    Prune stale records (all prunable models, or one)
  elyvel model:sync <Name> [--write]           Report (or add) declare fields missing vs. the DB table

  elyvel db                                    Open the native database shell (sqlite3 / psql)
  elyvel db:show                               List tables with row counts
  elyvel db:table <name>                       Describe a table's columns
  elyvel db:monitor [--max=N]                  Report open connections (Postgres)
  elyvel route:list                            List all registered HTTP routes
  elyvel queue:work [--connection=<name>]      Process queued jobs
                   [--queue=high,default] [--once|--stop-when-empty|--max=N]
                   [--sleep=N] [--retry-after=N]
  elyvel queue:failed                          List failed jobs
  elyvel queue:retry <id> | --all              Re-queue failed jobs
  elyvel queue:forget <id>                     Delete a failed job
  elyvel queue:flush                           Delete all failed jobs
  elyvel queue:prune-failed [--hours=24]       Delete failed jobs older than N hours
  elyvel queue:restart                         Gracefully restart running workers
  elyvel schedule:run                          Run scheduled tasks that are due now
  elyvel schedule:work                         Run the scheduler in-process (dev; ticks each minute)
  elyvel schedule:test [name]                  Run scheduled tasks now regardless of cron
  elyvel schedule:list                         List scheduled tasks and their cron
  elyvel broadcast:serve [--port=<n>]           Run the WebSocket/broadcast layer as its own process

  elyvel make:controller <Name>                Generate a controller plugin
  elyvel make:middleware <Name>                Generate a middleware plugin
  elyvel make:model <Name> [--migration] [--factory] [--seed] [--controller] [--all]
                                                Generate a model + table schema
                                                (companions: migration/factory/seeder/controller)
  elyvel make:migration <name>                 Generate a migration
  elyvel make:seeder <Name>                    Generate a seeder
  elyvel make:factory <Name>                   Generate a model factory (Faker)
  elyvel make:policy <Name> [--model[=Model]]  Generate an authorization policy
  elyvel make:request <Name>                   Generate a Form Request
  elyvel make:resource <Name>                  Generate an API Resource transform
  elyvel make:event <Name>                     Generate an event class
  elyvel make:listener <Name>                  Generate an event listener
  elyvel make:notification <Name>              Generate a notification
  elyvel make:provider <Name>                  Generate a service provider

  elyvel config:publish [name...] [--force]    Publish default config files to config/
  elyvel package:discover                      Auto-register installed packages' providers (bootstrap/providers.generated.ts)
`

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
    console.log(BANNER)
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

  if (command === 'migrate') {
    return migrateCommand(false)
  }

  if (command === 'migrate:fresh') {
    return migrateCommand(true)
  }

  if (command === 'migrate:rollback') {
    return rollbackCommand()
  }

  if (command === 'migrate:status') {
    return statusCommand()
  }

  if (command === 'migrate:unlock') {
    return unlockCommand()
  }

  if (command === 'db:seed') {
    return seedCommand()
  }

  if (command === 'model:prune') {
    return pruneCommand(rest[0])
  }

  if (command === 'model:sync') {
    return modelSyncCommand(rest[0], flags)
  }

  if (command === 'db') {
    return dbShellCommand()
  }

  if (command === 'db:show') {
    return dbShowCommand()
  }

  if (command === 'db:table') {
    return dbTableCommand(rest[0])
  }

  if (command === 'db:monitor') {
    return dbMonitorCommand(flags.max ? Number(flags.max) : undefined)
  }

  if (command === 'route:list') {
    return routeListCommand()
  }

  if (command === 'queue:work') {
    return queueWorkCommand(flags)
  }

  if (command === 'queue:failed') {
    return queueFailedCommand()
  }

  if (command === 'queue:retry') {
    return queueRetryCommand(rest[0], flags)
  }

  if (command === 'queue:forget') {
    return queueForgetCommand(rest[0])
  }

  if (command === 'queue:flush') {
    return queueFlushCommand()
  }

  if (command === 'queue:prune-failed') {
    return queuePruneFailedCommand(flags)
  }

  if (command === 'queue:restart') {
    return queueRestartCommand()
  }

  if (command === 'schedule:run') {
    return scheduleRunCommand()
  }

  if (command === 'schedule:work') {
    return scheduleWorkCommand()
  }

  if (command === 'schedule:test') {
    return scheduleTestCommand(rest[0])
  }

  if (command === 'schedule:list') {
    return scheduleListCommand()
  }

  if (command === 'broadcast:serve') {
    return broadcastServeCommand(flags)
  }

  if (command.startsWith('make:')) {
    return make(command.slice('make:'.length), rest[0], flags)
  }

  console.error(`Unknown command "${command}".`)
  console.log(BANNER)
  return 1
}

// Re-export the scaffold API so wrappers (e.g. the `create-elyvel` launcher for
// `bun create elyvel`) reuse the exact same logic and bundled templates.
export { newApp } from './commands/new'

// Only run the CLI when executed as the entry point — importing this module
// (for the exports above) must not run `main()` / exit the process.
if (import.meta.main)
  process.exit(await main())
