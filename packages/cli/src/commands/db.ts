import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createApp } from '@elysia-ravel/core'
import {
  type Connection,
  countRows,
  DatabaseToken,
  freshMigrate,
  listTables,
  migrate,
  type Model,
  openConnectionCount,
  rollback,
  runSeeders,
  type SeederClass,
  status,
  tableColumns,
} from '@elysia-ravel/database'

/** A model constructor with the static pruning API. */
type PrunableClass = typeof Model & { prune(chunkSize?: number): Promise<number> }

/** Boot the framework without HTTP routes — just enough to reach the DB. */
async function boot() {
  const app = await createApp({ basePath: process.cwd(), autoloadRoutes: false })
  return { app, conn: app.make(DatabaseToken) }
}

/** `ravel migrate` / `ravel migrate:fresh`. */
export async function migrateCommand(fresh: boolean): Promise<number> {
  const { app, conn } = await boot()
  const dir = app.path('database/migrations')

  const applied = fresh ? await freshMigrate(conn, dir) : await migrate(conn, dir)
  if (applied.length === 0) {
    console.log('Nothing to migrate.')
  } else {
    if (fresh) console.log('Dropped all tables, re-running migrations:')
    for (const name of applied) console.log(`✓ ${name}`)
  }
  return 0
}

/** `ravel migrate:rollback` — roll back the most recent batch. */
export async function rollbackCommand(): Promise<number> {
  const { app, conn } = await boot()
  const rolledBack = await rollback(conn, app.path('database/migrations'))
  if (rolledBack.length === 0) console.log('Nothing to roll back.')
  else for (const name of rolledBack) console.log(`✓ rolled back ${name}`)
  return 0
}

/** `ravel migrate:status` — show applied/pending migrations. */
export async function statusCommand(): Promise<number> {
  const { app, conn } = await boot()
  const rows = await status(conn, app.path('database/migrations'))
  if (rows.length === 0) console.log('No migrations found.')
  else for (const r of rows) console.log(`${r.ran ? '✓ ran    ' : '· pending'}  ${r.name}`)
  return 0
}

/** `ravel db:seed` — runs `database/seeders/DatabaseSeeder.ts`. */
export async function seedCommand(): Promise<number> {
  const { app } = await boot()
  const seederPath = app.path('database/seeders/DatabaseSeeder.ts')

  if (!existsSync(seederPath)) {
    console.error('No database/seeders/DatabaseSeeder.ts found. Create one with: ravel make:seeder Database')
    return 1
  }

  const module = (await import(seederPath)) as { default?: SeederClass }
  if (!module.default) {
    console.error('DatabaseSeeder.ts must default-export a Seeder class.')
    return 1
  }

  await runSeeders([module.default])
  console.log('✓ Database seeded.')
  return 0
}

/**
 * `ravel model:prune [Name]` — permanently delete records matched by each model's
 * `prunable()`. With a name, prunes just `app/models/<Name>.ts`; otherwise scans
 * `app/models/` and prunes every model that overrides `prunable()`.
 */
export async function pruneCommand(name?: string): Promise<number> {
  const { app } = await boot()
  const dir = app.path('app/models')

  let files: string[]
  if (name) {
    const file = join(dir, `${name}.ts`)
    if (!existsSync(file)) {
      console.error(`No model found at app/models/${name}.ts`)
      return 1
    }
    files = [file]
  } else {
    if (!existsSync(dir)) {
      console.error('No app/models directory found.')
      return 1
    }
    files = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => join(dir, f))
  }

  let anyPruned = false
  for (const file of files) {
    const module = (await import(file)) as { default?: unknown }
    const cls = module.default as PrunableClass | undefined
    if (typeof cls?.prune !== 'function' || cls.prunable() === null) {
      if (name) console.log(`${name} is not prunable (override static prunable()).`)
      continue
    }
    const count = await cls.prune()
    console.log(`✓ pruned ${count} ${cls.name} record${count === 1 ? '' : 's'}`)
    anyPruned = true
  }

  if (!anyPruned && !name) console.log('Nothing to prune.')
  return 0
}

/** `ravel db:show` — list tables with row counts. */
export async function dbShowCommand(): Promise<number> {
  const { app, conn } = await boot()
  const connection = conn as Connection
  const name = app.config.get<string>('database.default', 'sqlite')
  console.log(`Connection: ${name} (${connection.dialect})`)

  const tables = await listTables(connection)
  if (tables.length === 0) {
    console.log('No tables.')
    return 0
  }
  const rows = await Promise.all(
    tables.map(async (t) => ({ table: t, rows: await countRows(connection, t) })),
  )
  const width = Math.max(...rows.map((r) => r.table.length), 'Table'.length)
  console.log(`${'Table'.padEnd(width)}  Rows`)
  for (const r of rows) console.log(`${r.table.padEnd(width)}  ${r.rows}`)
  return 0
}

/** `ravel db:table <name>` — describe a table's columns. */
export async function dbTableCommand(table?: string): Promise<number> {
  if (!table) {
    console.error('Usage: ravel db:table <name>')
    return 1
  }
  const { conn } = await boot()
  const connection = conn as Connection

  const tables = await listTables(connection)
  if (!tables.includes(table)) {
    console.error(`Table "${table}" not found.`)
    return 1
  }
  const columns = await tableColumns(connection, table)
  const w = Math.max(...columns.map((c) => c.name.length), 'Column'.length)
  const tw = Math.max(...columns.map((c) => c.type.length), 'Type'.length)
  console.log(`${'Column'.padEnd(w)}  ${'Type'.padEnd(tw)}  Nullable  Default`)
  for (const c of columns) {
    console.log(
      `${c.name.padEnd(w)}  ${c.type.padEnd(tw)}  ${(c.nullable ? 'yes' : 'no').padEnd(8)}  ${c.default ?? ''}`,
    )
  }
  return 0
}

/** `ravel db:monitor [--max=N]` — report open connections (Postgres only). */
export async function dbMonitorCommand(max = 100): Promise<number> {
  const { conn } = await boot()
  const connection = conn as Connection
  const count = await openConnectionCount(connection)
  if (count === null) {
    console.log(`Connection monitoring is only supported on Postgres (dialect: ${connection.dialect}).`)
    return 0
  }
  console.log(`Open connections: ${count} / ${max}`)
  if (count > max) {
    console.error(`⚠ Open connections (${count}) exceed the max (${max}).`)
    return 1
  }
  return 0
}

/** `ravel db` — open the native database shell (sqlite3 / psql). */
export async function dbShellCommand(): Promise<number> {
  const { app } = await boot()
  const name = app.config.get<string>('database.default', 'sqlite')
  const config = app.config.get<Record<string, unknown>>(`database.connections.${name}`, {})

  let cmd: string[]
  if (config.driver === 'sqlite') {
    cmd = ['sqlite3', app.path(String(config.database))]
  } else if (config.driver === 'pg') {
    cmd = ['psql', String(config.url)]
  } else {
    console.error(`No interactive shell for driver "${String(config.driver)}".`)
    return 1
  }

  try {
    const proc = Bun.spawn(cmd, { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
    return await proc.exited
  } catch {
    console.error(`Could not launch "${cmd[0]}". Is it installed and on your PATH?`)
    return 1
  }
}
