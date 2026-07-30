import type { Connection } from './connection'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { SchemaBuilder } from './schema'
import { loadSchemaDump } from './schema-dump'

/**
 * A migration file default-exports one of these. `up` applies the change,
 * `down` reverses it — both via the dialect-agnostic {@link SchemaBuilder}, so
 * one migration runs on SQLite and Postgres with no raw SQL.
 */
export interface Migration {
  up(schema: SchemaBuilder): void | Promise<void>
  down(schema: SchemaBuilder): void | Promise<void>
}

const TABLE = '_elyvel_migrations'
const LOCK_TABLE = '_elyvel_migrations_lock'
const LOCK_ROW_ID = 1

/**
 * Optional bridge so migration lifecycle events also flow through an app-wide
 * event dispatcher (the same injectable pattern as `configureModelEventDispatcher`/
 * `configureQueueEventDispatcher`). Wire it once at boot, e.g.
 * `configureMigrationEventDispatcher((name, payload) => event(name, payload))`,
 * then `listen('migration.ended', ...)`. Kept injectable so the database
 * package stays decoupled from `@elyvel/events`. Never fires during
 * `--pretend` (no actual migrating happens then).
 *
 * Events: `migrations.started`/`migrations.ended` once per `migrate()`/
 * `rollback()`/`reset()` call (payload: `{ names, direction }`), and
 * `migration.started`/`migration.ended` per migration (payload:
 * `{ name, direction }`, `direction` is `'up'` or `'down'`).
 */
type MigrationEventDispatcher = (eventName: string, payload: Record<string, unknown>) => void | Promise<void>
let migrationEventDispatcher: MigrationEventDispatcher | null = null
export function configureMigrationEventDispatcher(dispatcher: MigrationEventDispatcher): void {
  migrationEventDispatcher = dispatcher
}
async function fireMigrationEvent(name: string, payload: Record<string, unknown>): Promise<void> {
  if (migrationEventDispatcher)
    await migrationEventDispatcher(name, payload)
}

/**
 * Thrown when another process (or another instance in a rolling deploy) is
 * already migrating. Not silently swallowed — the caller should know a
 * migration didn't run rather than assume "nothing to migrate" (which
 * `migrate()` returning `[]` would otherwise look identical to).
 */
export class MigrationLockError extends Error {
  constructor() {
    super('[elyvel] Migrations are locked — another process is migrating right now. Try again shortly.')
    this.name = 'MigrationLockError'
  }
}

/**
 * A held lock older than this is assumed abandoned by a crashed process (the
 * `finally` that normally deletes the row never got to run) and is safe to
 * steal — no real migration run takes anywhere near this long. Without a TTL,
 * a process killed mid-migration (OOM, `kill -9`, a cancelled CI job) leaves
 * the row forever, permanently blocking every future `migrate`/`rollback`
 * from any process until someone manually deletes it.
 */
const LOCK_STALE_MS = 10 * 60 * 1000

async function ensureLockTable(conn: Connection): Promise<void> {
  await conn.statement(
    `CREATE TABLE IF NOT EXISTS ${LOCK_TABLE} (id INTEGER PRIMARY KEY, locked_at VARCHAR(255) NOT NULL)`,
  )
}

async function currentLock(conn: Connection): Promise<{ lockedAt: number } | null> {
  const g = conn.grammar
  const rows = await conn.select<{ locked_at: string }>(
    `SELECT locked_at FROM ${LOCK_TABLE} WHERE id = ${g.placeholder(0)}`,
    [LOCK_ROW_ID],
  )
  const row = rows[0]
  return row ? { lockedAt: new Date(row.locked_at).getTime() } : null
}

/** `elyvel migrate:unlock` — force-clear a stuck lock without waiting out the TTL. */
export async function forceUnlock(conn: Connection): Promise<boolean> {
  await ensureLockTable(conn)
  const g = conn.grammar
  const existed = (await currentLock(conn)) !== null
  await conn.statement(`DELETE FROM ${LOCK_TABLE} WHERE id = ${g.placeholder(0)}`, [LOCK_ROW_ID])
  return existed
}

/**
 * Acquire the cross-process migration lock via a plain `INSERT` into a
 * single-row table — the row's PRIMARY KEY collision IS the mutex, so this
 * works identically on SQLite/MySQL/Postgres with no driver-specific
 * advisory-lock function. Without this, two processes/instances (e.g. each
 * replica in a rolling deploy running `elyvel migrate` on boot) can both read
 * the same "pending" list and apply — or interleave — the same migration.
 */
async function withMigrationLock<T>(conn: Connection, fn: () => Promise<T>): Promise<T> {
  const g = conn.grammar
  try {
    await ensureLockTable(conn)
    // A stale lock (older than LOCK_STALE_MS) means whoever held it crashed
    // before releasing it — steal it rather than blocking every future
    // migration run forever. A live holder racing this steal just re-inserts
    // and wins or loses the same INSERT-collision race as before.
    const existing = await currentLock(conn)
    if (existing && Date.now() - existing.lockedAt > LOCK_STALE_MS)
      await conn.statement(`DELETE FROM ${LOCK_TABLE} WHERE id = ${g.placeholder(0)}`, [LOCK_ROW_ID])
    // Both statements together: under real contention (two processes hitting
    // this at once), SQLite/MySQL/Postgres can surface a transient busy/lock
    // error from either one, not just a clean unique-constraint violation on
    // the INSERT — treat any failure here as "couldn't acquire right now."
    await conn.statement(
      `INSERT INTO ${LOCK_TABLE} (id, locked_at) VALUES (${g.placeholder(0)}, ${g.placeholder(1)})`,
      [LOCK_ROW_ID, new Date().toISOString()],
    )
  }
  catch {
    throw new MigrationLockError()
  }
  try {
    return await fn()
  }
  finally {
    await conn.statement(`DELETE FROM ${LOCK_TABLE} WHERE id = ${g.placeholder(0)}`, [LOCK_ROW_ID])
  }
}

async function ensureLedger(conn: Connection): Promise<void> {
  await conn.statement(
    // `name` is a PRIMARY KEY, so it must be VARCHAR (not TEXT) — MySQL rejects
    // a TEXT/BLOB key without a length; VARCHAR(255) works on all three dialects.
    `CREATE TABLE IF NOT EXISTS ${TABLE} (name VARCHAR(255) PRIMARY KEY, batch INTEGER NOT NULL, ran_at TEXT NOT NULL)`,
  )
}
async function ranNames(conn: Connection): Promise<Set<string>> {
  const rows = await conn.select<{ name: string }>(`SELECT name FROM ${TABLE}`)
  return new Set(rows.map(r => r.name))
}
async function nextBatch(conn: Connection): Promise<number> {
  const rows = await conn.select<{ b: number | string }>(
    `SELECT COALESCE(MAX(batch), 0) AS b FROM ${TABLE}`,
  )
  return Number(rows[0]?.b ?? 0) + 1
}

interface LoadedMigration {
  name: string
  migration: Migration
}

export async function loadMigrations(dir: string): Promise<LoadedMigration[]> {
  if (!existsSync(dir))
    return []
  const glob = new Bun.Glob('*.{ts,js}')
  const names: string[] = []
  for await (const file of glob.scan({ cwd: dir, onlyFiles: true })) {
    if (!file.endsWith('.d.ts'))
      names.push(file)
  }
  names.sort()

  const loaded: LoadedMigration[] = []
  for (const file of names) {
    const module = (await import(join(dir, file))) as { default?: Migration }
    if (module.default?.up) {
      loaded.push({ name: file.replace(/\.(ts|js)$/, ''), migration: module.default })
    }
  }
  return loaded
}

export interface MigrateOptions {
  /** Run each migration as its own batch, so `migrate:rollback` can undo them one at a time. */
  step?: boolean
  /** Collect the SQL each migration would run instead of executing it — no ledger writes either. */
  pretend?: string[]
  /**
   * Path to a `schema:dump` file. Loaded first when the database has never been
   * migrated, so a fresh checkout/CI run builds the structure in one step instead
   * of replaying every migration.
   */
  schemaDumpPath?: string
}

/** The actual "apply pending migrations" work — always called with the lock already held. */
async function runPending(conn: Connection, dir: string, options: MigrateOptions = {}): Promise<string[]> {
  await ensureLedger(conn)
  const ran = await ranNames(conn)
  let batch = await nextBatch(conn)
  const schema = new SchemaBuilder(conn, { dryRun: options.pretend })
  const pending = (await loadMigrations(dir)).filter(m => !ran.has(m.name))
  const g = conn.grammar

  if (pending.length > 0 && !options.pretend)
    await fireMigrationEvent('migrations.started', { names: pending.map(m => m.name), direction: 'up' })

  const applied: string[] = []
  for (const { name, migration } of pending) {
    if (!options.pretend)
      await fireMigrationEvent('migration.started', { name, direction: 'up' })
    await migration.up(schema)
    if (!options.pretend) {
      await conn.statement(
        `INSERT INTO ${TABLE} (name, batch, ran_at) VALUES (${g.placeholder(0)}, ${g.placeholder(1)}, ${g.placeholder(2)})`,
        [name, batch, new Date().toISOString()],
      )
      await fireMigrationEvent('migration.ended', { name, direction: 'up' })
    }
    applied.push(name)
    if (options.step)
      batch++
  }
  if (pending.length > 0 && !options.pretend)
    await fireMigrationEvent('migrations.ended', { names: applied, direction: 'up' })
  return applied
}

/**
 * Apply pending migrations. Throws {@link MigrationLockError} instead of
 * running if another process holds the migration lock (e.g. a sibling
 * instance in a rolling deploy already migrating) — see {@link withMigrationLock}.
 */
export async function migrate(conn: Connection, dir: string, options: MigrateOptions = {}): Promise<string[]> {
  return withMigrationLock(conn, async () => {
    // On a database that has never been migrated, load a `schema:dump` file when
    // one exists — that's the point of the dump: build the structure in one step
    // and then replay only the migrations written after it. The dump carries its
    // own applied-migration rows, so those are not re-run.
    if (options.schemaDumpPath && !(await hasMigrationsTable(conn)))
      await loadSchemaDump(conn, options.schemaDumpPath)
    return runPending(conn, dir, options)
  })
}

async function hasMigrationsTable(conn: Connection): Promise<boolean> {
  return (await userTables(conn)).includes(TABLE)
}

async function userTables(conn: Connection): Promise<string[]> {
  if (conn.dialect === 'sqlite') {
    const rows = await conn.select<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
    )
    return rows.map(r => r.name)
  }
  if (conn.dialect === 'mysql') {
    const rows = await conn.select<{ name: string }>(
      `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`,
    )
    return rows.map(r => r.name)
  }
  const rows = await conn.select<{ name: string }>(
    `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'`,
  )
  return rows.map(r => r.name)
}

export interface RollbackOptions {
  /** Roll back this many of the most-recently-run migrations, across batches, instead of just the last batch. */
  step?: number
  /** Roll back this specific batch number instead of the last one. */
  batch?: number
  /** Collect the SQL each `down()` would run instead of executing it — no ledger writes either. */
  pretend?: string[]
}

/** Shared by {@link rollback} and {@link reset}: run `down()` for every name in `targetNames`. */
async function runDown(
  conn: Connection,
  dir: string,
  targetNames: Set<string>,
  pretend?: string[],
): Promise<string[]> {
  if (targetNames.size === 0)
    return []
  const schema = new SchemaBuilder(conn, { dryRun: pretend })
  const g = conn.grammar
  const toRun = (await loadMigrations(dir)).reverse().filter(({ name }) => targetNames.has(name))

  if (!pretend)
    await fireMigrationEvent('migrations.started', { names: toRun.map(m => m.name), direction: 'down' })

  const rolledBack: string[] = []
  for (const { name, migration } of toRun) {
    if (!pretend)
      await fireMigrationEvent('migration.started', { name, direction: 'down' })
    await migration.down(schema)
    if (!pretend) {
      await conn.statement(`DELETE FROM ${TABLE} WHERE name = ${g.placeholder(0)}`, [name])
      await fireMigrationEvent('migration.ended', { name, direction: 'down' })
    }
    rolledBack.push(name)
  }
  if (!pretend)
    await fireMigrationEvent('migrations.ended', { names: rolledBack, direction: 'down' })
  return rolledBack
}

/**
 * Roll back migrations. By default, the most recent batch; `{ batch }` targets
 * a specific batch number, `{ step }` the last N migrations across batches
 * (most-recently-run first) regardless of which batch they're in.
 */
export async function rollback(conn: Connection, dir: string, options: RollbackOptions = {}): Promise<string[]> {
  return withMigrationLock(conn, async () => {
    await ensureLedger(conn)
    const rows = await conn.select<{ name: string, batch: number | string }>(
      `SELECT name, batch FROM ${TABLE} ORDER BY batch DESC, name DESC`,
    )
    if (rows.length === 0)
      return []

    let targetNames: Set<string>
    if (options.batch !== undefined) {
      targetNames = new Set(rows.filter(r => Number(r.batch) === options.batch).map(r => r.name))
    }
    else if (options.step !== undefined) {
      targetNames = new Set(rows.slice(0, options.step).map(r => r.name))
    }
    else {
      const maxBatch = Math.max(...rows.map(r => Number(r.batch)))
      targetNames = new Set(rows.filter(r => Number(r.batch) === maxBatch).map(r => r.name))
    }

    return runDown(conn, dir, targetNames, options.pretend)
  })
}

/** Roll back every applied migration (`migrate:reset` — unlike `rollback`, not just the last batch). */
export async function reset(conn: Connection, dir: string): Promise<string[]> {
  return withMigrationLock(conn, async () => {
    await ensureLedger(conn)
    const rows = await conn.select<{ name: string }>(`SELECT name FROM ${TABLE}`)
    return runDown(conn, dir, new Set(rows.map(r => r.name)))
  })
}

export interface RefreshOptions {
  /** Roll back and re-run only the last N migrations instead of the whole database. */
  step?: number
  /** Run after re-migrating (e.g. wire up `elyvel db:seed`'s DatabaseSeeder) — `migrate:refresh --seed`. */
  seed?(): Promise<void>
}

/** Roll back every migration (or the last `step`), then re-run `migrate` — `migrate:refresh`. */
export async function refresh(
  conn: Connection,
  dir: string,
  options: RefreshOptions = {},
): Promise<{ rolledBack: string[], applied: string[] }> {
  const rolledBack = options.step !== undefined
    ? await rollback(conn, dir, { step: options.step })
    : await reset(conn, dir)
  const applied = await migrate(conn, dir)
  if (options.seed)
    await options.seed()
  return { rolledBack, applied }
}

/** Report each migration's applied/pending state. */
export async function status(
  conn: Connection,
  dir: string,
): Promise<{ name: string, ran: boolean }[]> {
  await ensureLedger(conn)
  const ran = await ranNames(conn)
  return (await loadMigrations(dir)).map(m => ({ name: m.name, ran: ran.has(m.name) }))
}

export async function freshMigrate(conn: Connection, dir: string): Promise<string[]> {
  const tables = await userTables(conn)
  const cascade = conn.dialect === 'pg' ? ' CASCADE' : ''
  // Disable FK enforcement so tables can be dropped in any order.
  if (conn.dialect === 'sqlite')
    await conn.statement('PRAGMA foreign_keys = OFF;')
  if (conn.dialect === 'mysql')
    await conn.statement('SET FOREIGN_KEY_CHECKS = 0;')
  for (const name of tables) {
    await conn.statement(`DROP TABLE IF EXISTS ${conn.grammar.wrap(name)}${cascade}`)
  }
  if (conn.dialect === 'sqlite')
    await conn.statement('PRAGMA foreign_keys = ON;')
  if (conn.dialect === 'mysql')
    await conn.statement('SET FOREIGN_KEY_CHECKS = 1;')
  return migrate(conn, dir)
}
