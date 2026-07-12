import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Connection } from './connection'
import { SchemaBuilder } from './schema'

/**
 * A migration file default-exports one of these. `up` applies the change,
 * `down` reverses it — both via the dialect-agnostic {@link SchemaBuilder}, so
 * one migration runs on SQLite and Postgres with no raw SQL.
 */
export interface Migration {
  up(schema: SchemaBuilder): void | Promise<void>
  down(schema: SchemaBuilder): void | Promise<void>
}

const TABLE = '_ravel_migrations'

async function ensureLedger(conn: Connection): Promise<void> {
  await conn.statement(
    `CREATE TABLE IF NOT EXISTS ${TABLE} (name TEXT PRIMARY KEY, batch INTEGER NOT NULL, ran_at TEXT NOT NULL)`,
  )
}
async function ranNames(conn: Connection): Promise<Set<string>> {
  const rows = await conn.select<{ name: string }>(`SELECT name FROM ${TABLE}`)
  return new Set(rows.map((r) => r.name))
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
  if (!existsSync(dir)) return []
  const glob = new Bun.Glob('*.{ts,js}')
  const names: string[] = []
  for await (const file of glob.scan({ cwd: dir, onlyFiles: true })) {
    if (!file.endsWith('.d.ts')) names.push(file)
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

export async function migrate(conn: Connection, dir: string): Promise<string[]> {
  await ensureLedger(conn)
  const ran = await ranNames(conn)
  const batch = await nextBatch(conn)
  const schema = new SchemaBuilder(conn)
  const pending = (await loadMigrations(dir)).filter((m) => !ran.has(m.name))
  const g = conn.grammar

  const applied: string[] = []
  for (const { name, migration } of pending) {
    await migration.up(schema)
    await conn.statement(
      `INSERT INTO ${TABLE} (name, batch, ran_at) VALUES (${g.placeholder(0)}, ${g.placeholder(1)}, ${g.placeholder(2)})`,
      [name, batch, new Date().toISOString()],
    )
    applied.push(name)
  }
  return applied
}

async function userTables(conn: Connection): Promise<string[]> {
  if (conn.dialect === 'sqlite') {
    const rows = await conn.select<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
    )
    return rows.map((r) => r.name)
  }
  const rows = await conn.select<{ name: string }>(
    `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'`,
  )
  return rows.map((r) => r.name)
}

/** Roll back the most recent batch (runs `down` in reverse, clears ledger rows). */
export async function rollback(conn: Connection, dir: string): Promise<string[]> {
  await ensureLedger(conn)
  const rows = await conn.select<{ name: string; batch: number | string }>(
    `SELECT name, batch FROM ${TABLE}`,
  )
  if (rows.length === 0) return []
  const maxBatch = Math.max(...rows.map((r) => Number(r.batch)))
  const inBatch = new Set(rows.filter((r) => Number(r.batch) === maxBatch).map((r) => r.name))

  const schema = new SchemaBuilder(conn)
  const g = conn.grammar
  const rolledBack: string[] = []
  for (const { name, migration } of (await loadMigrations(dir)).reverse()) {
    if (!inBatch.has(name)) continue
    await migration.down(schema)
    await conn.statement(`DELETE FROM ${TABLE} WHERE name = ${g.placeholder(0)}`, [name])
    rolledBack.push(name)
  }
  return rolledBack
}

/** Report each migration's applied/pending state. */
export async function status(
  conn: Connection,
  dir: string,
): Promise<{ name: string; ran: boolean }[]> {
  await ensureLedger(conn)
  const ran = await ranNames(conn)
  return (await loadMigrations(dir)).map((m) => ({ name: m.name, ran: ran.has(m.name) }))
}

export async function freshMigrate(conn: Connection, dir: string): Promise<string[]> {
  const tables = await userTables(conn)
  const cascade = conn.dialect === 'pg' ? ' CASCADE' : ''
  if (conn.dialect === 'sqlite') await conn.statement('PRAGMA foreign_keys = OFF;')
  for (const name of tables) {
    await conn.statement(`DROP TABLE IF EXISTS ${conn.grammar.wrap(name)}${cascade}`)
  }
  if (conn.dialect === 'sqlite') await conn.statement('PRAGMA foreign_keys = ON;')
  return migrate(conn, dir)
}
