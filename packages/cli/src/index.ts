#!/usr/bin/env bun
import { migrateCommand, seedCommand } from './commands/db'
import { make } from './commands/make'
import { serve } from './commands/serve'

const BANNER = `
ravel — the elysia-ravel CLI

Usage:
  ravel serve [--entry <path>] [--no-watch]   Start the dev server

  ravel migrate                               Run pending migrations
  ravel migrate:fresh                         Drop all tables and re-migrate
  ravel db:seed                               Run database/seeders/DatabaseSeeder

  ravel make:controller <Name>                Generate a controller plugin
  ravel make:middleware <Name>                Generate a middleware plugin
  ravel make:model <Name>                     Generate a model + table schema
  ravel make:migration <name>                 Generate a migration
  ravel make:seeder <Name>                    Generate a seeder
  ravel make:policy <Name>                     Generate an authorization policy
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

  if (command === 'db:seed') {
    return seedCommand()
  }

  if (command.startsWith('make:')) {
    return make(command.slice('make:'.length), rest[0])
  }

  console.error(`Unknown command "${command}".`)
  console.log(BANNER)
  return 1
}

process.exit(await main())
