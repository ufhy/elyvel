#!/usr/bin/env bun
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
} from './commands/db'
import { make } from './commands/make'
import { serve } from './commands/serve'

const BANNER = `
ravel — the elysia-ravel CLI

Usage:
  ravel serve [--entry <path>] [--no-watch]   Start the dev server

  ravel migrate                               Run pending migrations
  ravel migrate:fresh                         Drop all tables and re-migrate
  ravel migrate:rollback                      Roll back the last migration batch
  ravel migrate:status                        Show applied/pending migrations
  ravel db:seed                               Run database/seeders/DatabaseSeeder
  ravel model:prune [Name]                    Prune stale records (all prunable models, or one)

  ravel db                                    Open the native database shell (sqlite3 / psql)
  ravel db:show                               List tables with row counts
  ravel db:table <name>                       Describe a table's columns
  ravel db:monitor [--max=N]                  Report open connections (Postgres)

  ravel make:controller <Name>                Generate a controller plugin
  ravel make:middleware <Name>                Generate a middleware plugin
  ravel make:model <Name>                     Generate a model + table schema
  ravel make:migration <name>                 Generate a migration
  ravel make:seeder <Name>                    Generate a seeder
  ravel make:policy <Name>                    Generate an authorization policy
`

/** Split argv into positionals and `--flag[=value]` pairs. */
function parseArgs(argv: string[]) {
  const positionals: string[] = []
  const flags: Record<string, string | boolean> = {}

  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [rawKey = '', value] = arg.slice(2).split('=')
      const key = rawKey.startsWith('no-') ? rawKey.slice(3) : rawKey
      flags[key] = value ?? !rawKey.startsWith('no-')
    } else {
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

  if (command === 'serve') {
    return serve(flags)
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

  if (command === 'db:seed') {
    return seedCommand()
  }

  if (command === 'model:prune') {
    return pruneCommand(rest[0])
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

  if (command.startsWith('make:')) {
    return make(command.slice('make:'.length), rest[0])
  }

  console.error(`Unknown command "${command}".`)
  console.log(BANNER)
  return 1
}

process.exit(await main())
