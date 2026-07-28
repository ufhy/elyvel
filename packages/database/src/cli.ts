import type { ConsoleCommand } from '@elyvel/core'
import type { Connection } from './connection'
import type { ColumnInfo } from './inspect'
import type { Cast, Model } from './model'
import type { SeederClass } from './seeder'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { comment, error, info, table, warn } from '@elyvel/cli'
import { createApp } from '@elyvel/core'
import {
  countRows,
  listTables,
  openConnectionCount,
  tableColumns,
} from './inspect'
import {
  forceUnlock,
  freshMigrate,
  migrate,
  refresh,
  reset,
  rollback,
  status,
} from './migrator'
import { runSeeders } from './seeder'
import { DatabaseToken } from './tokens'

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
    comment('Nothing to migrate.')
  }
  else {
    if (fresh)
      info('Dropped all tables, re-running migrations:')
    for (const name of applied) info(`✓ ${name}`)
  }
  if (fresh && flags.seed) {
    const seeder = await loadSeeder(app)
    if (!seeder) {
      error(
        'No database/seeders/DatabaseSeeder.ts found. Create one with: elyvel make:seeder Database',
      )
      return 1
    }
    await runSeeders([seeder])
    info('✓ Database seeded.')
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
    comment('Nothing to roll back.')
  }
  else {
    for (const name of rolledBack) info(`✓ rolled back ${name}`)
  }
  return 0
}

/** `elyvel migrate:reset` — roll back every applied migration. */
export async function resetCommand(): Promise<number> {
  const { app, conn } = await boot()
  const rolledBack = await reset(conn, app.path('database/migrations'))
  if (rolledBack.length === 0) {
    comment('Nothing to roll back.')
  }
  else {
    for (const name of rolledBack) info(`✓ rolled back ${name}`)
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
          error(
            'No database/seeders/DatabaseSeeder.ts found. Create one with: elyvel make:seeder Database',
          )
          return
        }
        await runSeeders([seeder])
      }
      : undefined,
  })

  for (const name of rolledBack) info(`✓ rolled back ${name}`)
  for (const name of applied) info(`✓ ${name}`)
  if (rolledBack.length === 0 && applied.length === 0)
    comment('Nothing to refresh.')
  if (flags.seed)
    info('✓ Database seeded.')
  return 0
}

function printPretend(sql: string[]): void {
  if (sql.length === 0) {
    comment('Nothing to migrate.')
    return
  }
  for (const stmt of sql) info(stmt)
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
  info(existed ? 'Migration lock cleared.' : 'No migration lock was held.')
  return 0
}

/** `elyvel migrate:status` — show applied/pending migrations. */
export async function statusCommand(): Promise<number> {
  const { app, conn } = await boot()
  const rows = await status(conn, app.path('database/migrations'))
  if (rows.length === 0) {
    comment('No migrations found.')
  }
  else {
    for (const r of rows) info(`${r.ran ? '✓ ran    ' : '· pending'}  ${r.name}`)
  }
  return 0
}

/** `elyvel db:seed` — runs `database/seeders/DatabaseSeeder.ts`. */
export async function seedCommand(): Promise<number> {
  const { app } = await boot()
  const seeder = await loadSeeder(app)
  if (!seeder) {
    error(
      'No database/seeders/DatabaseSeeder.ts found. Create one with: elyvel make:seeder Database',
    )
    return 1
  }

  await runSeeders([seeder])
  info('✓ Database seeded.')
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
      error(`No model found at app/models/${name}.ts`)
      return 1
    }
    files = [file]
  }
  else {
    if (!existsSync(dir)) {
      error('No app/models directory found.')
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
        comment(`${name} is not prunable (override static prunable()).`)
      continue
    }
    const count = await cls.prune()
    info(`✓ pruned ${count} ${cls.name} record${count === 1 ? '' : 's'}`)
    anyPruned = true
  }

  if (!anyPruned && !name)
    comment('Nothing to prune.')
  return 0
}

/** `elyvel db:show` — list tables with row counts. */
export async function dbShowCommand(): Promise<number> {
  const { app, conn } = await boot()
  const connection = conn as Connection
  const name = app.config.get<string>('database.default', 'sqlite')
  info(`Connection: ${name} (${connection.dialect})`)

  const tables = await listTables(connection)
  if (tables.length === 0) {
    comment('No tables.')
    return 0
  }
  const rows = await Promise.all(
    tables.map(async t => ({ table: t, rows: await countRows(connection, t) })),
  )
  table(['Table', 'Rows'], rows.map(r => [r.table, String(r.rows)]))
  return 0
}

/** `elyvel db:table <name>` — describe a table's columns. */
export async function dbTableCommand(tableName?: string): Promise<number> {
  if (!tableName) {
    error('Usage: elyvel db:table <name>')
    return 1
  }
  const { conn } = await boot()
  const connection = conn as Connection

  const tables = await listTables(connection)
  if (!tables.includes(tableName)) {
    error(`Table "${tableName}" not found.`)
    return 1
  }
  const columns = await tableColumns(connection, tableName)
  table(
    ['Column', 'Type', 'Nullable', 'Default'],
    columns.map(c => [c.name, c.type, c.nullable ? 'yes' : 'no', c.default ?? '']),
  )
  return 0
}

/** `elyvel db:monitor [--max=N]` — report open connections (Postgres only). */
export async function dbMonitorCommand(max = 100): Promise<number> {
  const { conn } = await boot()
  const connection = conn as Connection
  const count = await openConnectionCount(connection)
  if (count === null) {
    comment(
      `Connection monitoring is only supported on Postgres (dialect: ${connection.dialect}).`,
    )
    return 0
  }
  info(`Open connections: ${count} / ${max}`)
  if (count > max) {
    warn(`⚠ Open connections (${count}) exceed the max (${max}).`)
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
    error(`No interactive shell for driver "${String(config.driver)}".`)
    return 1
  }

  try {
    const proc = Bun.spawn(cmd, { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
    return await proc.exited
  }
  catch {
    error(`Could not launch "${cmd[0]}". Is it installed and on your PATH?`)
    return 1
  }
}

// ── model:sync ───────────────────────────────────────────────────────────

/** The static config `resolveType`/`planModelSync` need — a plain object so it's testable without a real Model subclass. */
export interface ModelMeta {
  primaryKey: string
  createdAtColumn: string
  updatedAtColumn: string
  deletedAtColumn: string
  casts: Record<string, Cast>
}

/** The TS type a cast produces when read (mirrors `castGet` in `model.ts`). */
export function castToType(cast: Cast): string {
  if (typeof cast === 'object')
    return 'unknown'
  switch (cast) {
    case 'int':
    case 'integer':
    case 'float':
    case 'double':
      return 'number'
    case 'boolean':
    case 'bool':
      return 'boolean'
    case 'string':
      return 'string'
    case 'json':
    case 'array':
      return 'Record<string, unknown>'
    case 'date':
    case 'datetime':
      return 'Dayjs'
    case 'encrypted':
      return 'unknown'
  }
}

/**
 * Best-effort guess from the raw DB column type — only reached when there's no
 * cast to go by. elyvel's own migrations store json/date/datetime as TEXT/VARCHAR
 * (see grammar.ts), so this can't reliably detect those; it only recognizes
 * genuinely typed columns (numbers, native booleans, native json).
 */
export function inferFromDbType(rawType: string, dialect: string): string {
  const t = rawType.toLowerCase()
  if (dialect === 'mysql') {
    if (/^tinyint\(1\)/.test(t))
      return 'boolean'
    if (/^(?:tinyint|smallint|mediumint|int|bigint|decimal|float|double)/.test(t))
      return 'number'
    if (t === 'json')
      return 'Record<string, unknown>'
    return 'string'
  }
  if (dialect === 'pg') {
    if (t === 'boolean')
      return 'boolean'
    if (/^(?:smallint|integer|bigint|numeric|real|double precision|serial|bigserial)/.test(t))
      return 'number'
    if (t === 'json' || t === 'jsonb')
      return 'Record<string, unknown>'
    return 'string'
  }
  // sqlite: booleans/timestamps share the same affinity as plain numbers/text.
  if (t === 'integer' || t === 'real' || t === 'numeric')
    return 'number'
  return 'string'
}

export function resolveType(column: ColumnInfo, meta: ModelMeta, dialect: string): string {
  // created_at/updated_at are DB-nullable (see schema.ts) but `save()` always
  // populates them before a row is ever read back — declare them non-null to
  // match the hand-written convention elsewhere. deleted_at stays nullable:
  // that one is null for most of a row's life.
  if (column.name === meta.createdAtColumn || column.name === meta.updatedAtColumn)
    return 'Dayjs'
  if (column.name === meta.deletedAtColumn)
    return 'Dayjs | null'

  const cast = meta.casts[column.name]
  const base = cast ? castToType(cast) : inferFromDbType(column.type, dialect)
  // SQLite reports an INTEGER PRIMARY KEY column as nullable in its own catalog
  // (a rowid-alias quirk) even though it can never actually be null.
  const nullable = column.name === meta.primaryKey ? false : column.nullable
  return nullable ? `${base} | null` : base
}

export interface ModelSyncPlan {
  /** Columns missing a `declare` line, with the line to add for each. */
  missing: ColumnInfo[]
  lines: string[]
  /** `declare`d fields with no matching DB column (possible drift/typo) — reported, never removed. */
  stale: string[]
}

/** Diff a model's real (non-commented) `declare` lines against its table's columns. Pure — no I/O. */
export function planModelSync(source: string, columns: ColumnInfo[], meta: ModelMeta, dialect: string): ModelSyncPlan {
  // Only real `declare` lines — a commented-out example (`//   declare foo: Bar`)
  // must not count as either "already declared" or a stale field.
  const declared = new Set(
    source.split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('declare '))
      .map(line => /^declare\s+(\w+)/.exec(line)?.[1])
      .filter((name): name is string => Boolean(name)),
  )

  const stale = [...declared].filter(field => !columns.some(c => c.name === field))
  const missing = columns.filter(c => !declared.has(c.name))
  const lines = missing.map(c => `  declare ${c.name}: ${resolveType(c, meta, dialect)}`)

  return { missing, lines, stale }
}

/**
 * Add the given `declare` lines to a model's source (after the last existing
 * `declare` line, or the last `static` line, or right inside the class body),
 * activating/adding the `Dayjs` import if any line needs it. Pure — no I/O.
 */
export function applyModelSync(source: string, lines: string[]): string | null {
  const rows = source.split('\n')
  const lastDeclareIdx = rows.reduce((last, line, i) => (/^\s*declare\s+\w+/.test(line) ? i : last), -1)
  const lastStaticIdx = rows.reduce((last, line, i) => (/^\s*static\s/.test(line) ? i : last), -1)
  const insertAt = lastDeclareIdx >= 0
    ? lastDeclareIdx + 1
    : lastStaticIdx >= 0
      ? lastStaticIdx + 1
      : rows.findIndex(l => /extends Model\s*\{/.test(l)) + 1

  if (insertAt <= 0)
    return null

  rows.splice(insertAt, 0, ...lines)

  // A generated `Dayjs` type needs the (often commented-out, stub-default) import active.
  if (lines.some(l => l.includes('Dayjs'))) {
    const hasLiveImport = rows.some(l => /^\s*import\s+type\s*\{[^}]*\bDayjs\b[^}]*\}\s*from\s*['"]@elyvel\/database['"]/.test(l))
    if (!hasLiveImport) {
      const commentedIdx = rows.findIndex(l => /^\s*\/\/\s*import\s+type\s*\{[^}]*\bDayjs\b[^}]*\}\s*from\s*['"]@elyvel\/database['"]/.test(l))
      if (commentedIdx >= 0) {
        rows[commentedIdx] = rows[commentedIdx]!.replace(/^(\s*)\/\/\s*/, '$1')
      }
      else {
        const lastImportIdx = rows.reduce((last, l, i) => (/^import\s/.test(l) ? i : last), -1)
        rows.splice(lastImportIdx + 1, 0, 'import type { Dayjs } from \'@elyvel/database\'')
      }
    }
  }

  return rows.join('\n')
}

/**
 * `elyvel model:sync <Name> [--write]` — introspect the model's table and report
 * (or, with `--write`, add) `declare` field lines for columns it doesn't yet
 * declare. Additive only: never touches `fillable`/`guarded` (mass-assignment is
 * a security boundary, not derivable from schema) or `casts` (runtime behavior),
 * and never removes/reorders an existing `declare` line — a mismatch is only
 * reported, so a computed/accessor-backed `declare` never gets clobbered.
 */
export async function modelSyncCommand(
  name?: string,
  flags: Record<string, string | boolean> = {},
): Promise<number> {
  if (!name) {
    error('Usage: elyvel model:sync <Name> [--write]')
    return 1
  }

  const { app, conn } = await boot()
  const file = app.path(`app/models/${name}.ts`)
  if (!existsSync(file)) {
    error(`No model found at app/models/${name}.ts`)
    return 1
  }

  const module = (await import(file)) as { default?: typeof Model }
  const cls = module.default
  if (!cls) {
    error(`${name}.ts must default-export a Model class.`)
    return 1
  }

  const table = cls.getTableName()
  const columns = await tableColumns(conn, table)
  const source = readFileSync(file, 'utf8')
  const meta: ModelMeta = {
    primaryKey: cls.primaryKey,
    createdAtColumn: cls.createdAtColumn,
    updatedAtColumn: cls.updatedAtColumn,
    deletedAtColumn: cls.deletedAtColumn,
    casts: cls.casts,
  }
  const { missing, lines, stale } = planModelSync(source, columns, meta, conn.dialect)

  if (stale.length > 0)
    warn(`⚠ declared in ${name}.ts but not in "${table}": ${stale.join(', ')}`)

  if (missing.length === 0) {
    info(`✓ ${name} is already in sync with "${table}".`)
    return 0
  }

  if (!flags.write) {
    comment(`Missing from ${name} (table "${table}"):\n${lines.join('\n')}\n\nRun with --write to add them.`)
    return 0
  }

  const updated = applyModelSync(source, lines)
  if (updated === null) {
    error(`Could not locate the class body in ${name}.ts — add manually:\n${lines.join('\n')}`)
    return 1
  }

  writeFileSync(file, updated)
  info(`✓ Added ${missing.length} field${missing.length === 1 ? '' : 's'} to ${name}.ts:\n${lines.join('\n')}`)
  return 0
}

/** Discovered by `elyvel package:discover` — see `@elyvel/core`'s `ConsoleCommand`. */
export const elyvelCommands: ConsoleCommand[] = [
  {
    name: 'migrate',
    description: 'Run pending migrations',
    usage: '[--step] [--pretend]',
    run: (flags: Record<string, string | boolean>) => migrateCommand(false, flags),
  },
  {
    name: 'migrate:fresh',
    description: 'Drop all tables and re-migrate',
    usage: '[--seed]',
    run: (flags: Record<string, string | boolean>) => migrateCommand(true, flags),
  },
  {
    name: 'migrate:rollback',
    description: 'Roll back migrations (last batch by default)',
    usage: '[--step=N] [--batch=N] [--pretend]',
    run: (flags: Record<string, string | boolean>) => rollbackCommand(flags),
  },
  {
    name: 'migrate:reset',
    description: 'Roll back every applied migration',
    run: () => resetCommand(),
  },
  {
    name: 'migrate:refresh',
    description: 'Roll back (all, or last N) then re-migrate',
    usage: '[--step=N] [--seed]',
    run: (flags: Record<string, string | boolean>) => refreshCommand(flags),
  },
  {
    name: 'migrate:status',
    description: 'Show applied/pending migrations',
    run: () => statusCommand(),
  },
  {
    name: 'migrate:unlock',
    description: 'Force-clear a stuck migration lock (crashed process)',
    run: () => unlockCommand(),
  },
  {
    name: 'db:seed',
    description: 'Run database/seeders/DatabaseSeeder',
    run: () => seedCommand(),
  },
  {
    name: 'model:prune',
    description: 'Prune stale records (all prunable models, or one)',
    usage: '[Name]',
    run: (_flags: Record<string, string | boolean>, args: string[]) => pruneCommand(args[0]),
  },
  {
    name: 'model:sync',
    description: 'Report (or add) declare fields missing vs. the DB table',
    usage: '<Name> [--write]',
    run: (flags: Record<string, string | boolean>, args: string[]) => modelSyncCommand(args[0], flags),
  },
  {
    name: 'db',
    description: 'Open the native database shell (sqlite3 / psql)',
    run: () => dbShellCommand(),
  },
  {
    name: 'db:show',
    description: 'List tables with row counts',
    run: () => dbShowCommand(),
  },
  {
    name: 'db:table',
    description: 'Describe a table\'s columns',
    usage: '<name>',
    run: (_flags: Record<string, string | boolean>, args: string[]) => dbTableCommand(args[0]),
  },
  {
    name: 'db:monitor',
    description: 'Report open connections (Postgres)',
    usage: '[--max=N]',
    run: (flags: Record<string, string | boolean>) => dbMonitorCommand(flags.max ? Number(flags.max) : undefined),
  },
]
