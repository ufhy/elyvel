import type { Connection, Model, SeederClass } from '@elyvel/database'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createApp } from '@elyvel/core'
import {

  countRows,
  DatabaseToken,
  forceUnlock,
  freshMigrate,
  listTables,

  migrate,
  openConnectionCount,
  refresh,
  reset,
  rollback,
  runSeeders,

  status,
  tableColumns,
} from '@elyvel/database'

/** Shared by every command that loads `database/seeders/DatabaseSeeder.ts` for `--seed`. */
async function loadSeeder(app: Awaited<ReturnType<typeof boot>>['app']): Promise<SeederClass | null> {
  const seederPath = app.path('database/seeders/DatabaseSeeder.ts')
  if (!existsSync(seederPath))
    return null
  const module = (await import(seederPath)) as { default?: SeederClass }
  return module.default ?? null
}

/** A model constructor with the static pruning API. */
type PrunableClass = typeof Model & { prune(chunkSize?: number): Promise<number> }

/** Boot the framework without HTTP routes — just enough to reach the DB. */
export async function boot() {
  const app = await createApp({ basePath: process.cwd(), autoloadRoutes: false })
  return { app, conn: app.make(DatabaseToken) }
}

interface MigrateFlags {
  step?: string | boolean
  pretend?: string | boolean
  seed?: string | boolean
}

/** `elyvel migrate` / `elyvel migrate:fresh` — `--step` batches each migration separately, `--pretend` only prints the SQL, `--seed` (fresh only) re-runs the DatabaseSeeder after. */
export async function migrateCommand(fresh: boolean, flags: MigrateFlags = {}): Promise<number> {
  const { app, conn } = await boot()
  const dir = app.path('database/migrations')
  const pretend = flags.pretend ? [] : undefined

  const applied = fresh
    ? await freshMigrate(conn, dir)
    : await migrate(conn, dir, { step: Boolean(flags.step), pretend })

  if (pretend) {
    printPretend(pretend)
    return 0
  }
  if (applied.length === 0) {
    console.log('Nothing to migrate.')
  }
  else {
    if (fresh)
      console.log('Dropped all tables, re-running migrations:')
    for (const name of applied) console.log(`✓ ${name}`)
  }
  if (fresh && flags.seed) {
    const seeder = await loadSeeder(app)
    if (!seeder) {
      console.error(
        'No database/seeders/DatabaseSeeder.ts found. Create one with: elyvel make:seeder Database',
      )
      return 1
    }
    await runSeeders([seeder])
    console.log('✓ Database seeded.')
  }
  return 0
}

interface RollbackFlags {
  step?: string | boolean
  batch?: string | boolean
  pretend?: string | boolean
}

/** `elyvel migrate:rollback` — the last batch by default; `--step=N` / `--batch=N` narrow it, `--pretend` only prints the SQL. */
export async function rollbackCommand(flags: RollbackFlags = {}): Promise<number> {
  const { app, conn } = await boot()
  const pretend = flags.pretend ? [] : undefined
  const rolledBack = await rollback(conn, app.path('database/migrations'), {
    step: flags.step !== undefined ? Number(flags.step) : undefined,
    batch: flags.batch !== undefined ? Number(flags.batch) : undefined,
    pretend,
  })

  if (pretend) {
    printPretend(pretend)
    return 0
  }
  if (rolledBack.length === 0) {
    console.log('Nothing to roll back.')
  }
  else {
    for (const name of rolledBack) console.log(`✓ rolled back ${name}`)
  }
  return 0
}

/** `elyvel migrate:reset` — roll back every applied migration. */
export async function resetCommand(): Promise<number> {
  const { app, conn } = await boot()
  const rolledBack = await reset(conn, app.path('database/migrations'))
  if (rolledBack.length === 0) {
    console.log('Nothing to roll back.')
  }
  else {
    for (const name of rolledBack) console.log(`✓ rolled back ${name}`)
  }
  return 0
}

interface RefreshFlags {
  step?: string | boolean
  seed?: string | boolean
}

/** `elyvel migrate:refresh` — roll back (all, or the last `--step=N`) then re-migrate; `--seed` re-runs the DatabaseSeeder after. */
export async function refreshCommand(flags: RefreshFlags = {}): Promise<number> {
  const { app, conn } = await boot()
  const dir = app.path('database/migrations')

  const { rolledBack, applied } = await refresh(conn, dir, {
    step: flags.step !== undefined ? Number(flags.step) : undefined,
    seed: flags.seed
      ? async () => {
        const seeder = await loadSeeder(app)
        if (!seeder) {
          console.error(
            'No database/seeders/DatabaseSeeder.ts found. Create one with: elyvel make:seeder Database',
          )
          return
        }
        await runSeeders([seeder])
      }
      : undefined,
  })

  for (const name of rolledBack) console.log(`✓ rolled back ${name}`)
  for (const name of applied) console.log(`✓ ${name}`)
  if (rolledBack.length === 0 && applied.length === 0)
    console.log('Nothing to refresh.')
  if (flags.seed)
    console.log('✓ Database seeded.')
  return 0
}

function printPretend(sql: string[]): void {
  if (sql.length === 0) {
    console.log('Nothing to migrate.')
    return
  }
  for (const stmt of sql) console.log(stmt)
}

/**
 * `elyvel migrate:unlock` — force-clear the migration lock. A live migration
 * (in this process or another) also gets stolen by this — only run it when
 * you're sure nothing is actually migrating right now (e.g. after confirming
 * a deploy died mid-migration well before the 10-minute auto-steal TTL).
 */
export async function unlockCommand(): Promise<number> {
  const { conn } = await boot()
  const existed = await forceUnlock(conn)
  console.log(existed ? 'Migration lock cleared.' : 'No migration lock was held.')
  return 0
}

/** `elyvel migrate:status` — show applied/pending migrations. */
export async function statusCommand(): Promise<number> {
  const { app, conn } = await boot()
  const rows = await status(conn, app.path('database/migrations'))
  if (rows.length === 0) {
    console.log('No migrations found.')
  }
  else {
    for (const r of rows) console.log(`${r.ran ? '✓ ran    ' : '· pending'}  ${r.name}`)
  }
  return 0
}

/** `elyvel db:seed` — runs `database/seeders/DatabaseSeeder.ts`. */
export async function seedCommand(): Promise<number> {
  const { app } = await boot()
  const seeder = await loadSeeder(app)
  if (!seeder) {
    console.error(
      'No database/seeders/DatabaseSeeder.ts found. Create one with: elyvel make:seeder Database',
    )
    return 1
  }

  await runSeeders([seeder])
  console.log('✓ Database seeded.')
  return 0
}

/**
 * `elyvel model:prune [Name]` — permanently delete records matched by each model's
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
  }
  else {
    if (!existsSync(dir)) {
      console.error('No app/models directory found.')
      return 1
    }
    files = readdirSync(dir)
      .filter(f => f.endsWith('.ts'))
      .map(f => join(dir, f))
  }

  let anyPruned = false
  for (const file of files) {
    const module = (await import(file)) as { default?: unknown }
    const cls = module.default as PrunableClass | undefined
    if (typeof cls?.prune !== 'function' || cls.prunable() === null) {
      if (name)
        console.log(`${name} is not prunable (override static prunable()).`)
      continue
    }
    const count = await cls.prune()
    console.log(`✓ pruned ${count} ${cls.name} record${count === 1 ? '' : 's'}`)
    anyPruned = true
  }

  if (!anyPruned && !name)
    console.log('Nothing to prune.')
  return 0
}

/** `elyvel db:show` — list tables with row counts. */
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
    tables.map(async t => ({ table: t, rows: await countRows(connection, t) })),
  )
  const width = Math.max(...rows.map(r => r.table.length), 'Table'.length)
  console.log(`${'Table'.padEnd(width)}  Rows`)
  for (const r of rows) console.log(`${r.table.padEnd(width)}  ${r.rows}`)
  return 0
}

/** `elyvel db:table <name>` — describe a table's columns. */
export async function dbTableCommand(table?: string): Promise<number> {
  if (!table) {
    console.error('Usage: elyvel db:table <name>')
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
  const w = Math.max(...columns.map(c => c.name.length), 'Column'.length)
  const tw = Math.max(...columns.map(c => c.type.length), 'Type'.length)
  console.log(`${'Column'.padEnd(w)}  ${'Type'.padEnd(tw)}  Nullable  Default`)
  for (const c of columns) {
    console.log(
      `${c.name.padEnd(w)}  ${c.type.padEnd(tw)}  ${(c.nullable ? 'yes' : 'no').padEnd(8)}  ${c.default ?? ''}`,
    )
  }
  return 0
}

/** `elyvel db:monitor [--max=N]` — report open connections (Postgres only). */
export async function dbMonitorCommand(max = 100): Promise<number> {
  const { conn } = await boot()
  const connection = conn as Connection
  const count = await openConnectionCount(connection)
  if (count === null) {
    console.log(
      `Connection monitoring is only supported on Postgres (dialect: ${connection.dialect}).`,
    )
    return 0
  }
  console.log(`Open connections: ${count} / ${max}`)
  if (count > max) {
    console.error(`⚠ Open connections (${count}) exceed the max (${max}).`)
    return 1
  }
  return 0
}

/** `elyvel db` — open the native database shell (sqlite3 / psql). */
export async function dbShellCommand(): Promise<number> {
  const { app } = await boot()
  const name = app.config.get<string>('database.default', 'sqlite')
  const config = app.config.get<Record<string, unknown>>(`database.connections.${name}`, {})

  let cmd: string[]
  if (config.driver === 'sqlite') {
    cmd = ['sqlite3', app.path(String(config.database))]
  }
  else if (config.driver === 'pg') {
    cmd = ['psql', String(config.url)]
  }
  else {
    console.error(`No interactive shell for driver "${String(config.driver)}".`)
    return 1
  }

  try {
    const proc = Bun.spawn(cmd, { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
    return await proc.exited
  }
  catch {
    console.error(`Could not launch "${cmd[0]}". Is it installed and on your PATH?`)
    return 1
  }
}
