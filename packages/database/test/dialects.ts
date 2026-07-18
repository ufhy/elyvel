import type { Connection } from '../src/connection'
import { createConnection } from '../src/connection'
import { listTables } from '../src/inspect'

export interface Dialect {
  name: string
  connect(): Promise<Connection>
}

// sqlite + pglite are in-process and ephemeral (fresh per connection), so they
// run the whole Active Record suite for free.
const base: Dialect[] = [
  { name: 'sqlite', connect: () => createConnection({ driver: 'sqlite', database: ':memory:' }) },
  { name: 'pglite', connect: () => createConnection({ driver: 'pglite' }) },
]

// MySQL is an external, persistent database, and its DDL auto-commits — so it
// can't be isolated by transaction rollback like the others. Instead, drop every
// table on connect for a clean slate per test. It joins the full suite whenever
// MYSQL_URL points at a reachable server (e.g. `MYSQL_URL=mysql://root:pw@localhost/elyvel_test`),
// and is skipped otherwise so the default run needs no MySQL server.
const MYSQL_URL = process.env.MYSQL_URL

async function connectMysql(): Promise<Connection> {
  const conn = await createConnection({ driver: 'mysql', url: MYSQL_URL! })
  const tables = await listTables(conn)
  if (tables.length) {
    await conn.unprepared('SET FOREIGN_KEY_CHECKS = 0')
    for (const t of tables) await conn.unprepared(`DROP TABLE IF EXISTS \`${t}\``)
    await conn.unprepared('SET FOREIGN_KEY_CHECKS = 1')
  }
  return conn
}

let mysqlOk = false
if (MYSQL_URL) {
  try {
    const probe = await createConnection({ driver: 'mysql', url: MYSQL_URL })
    await probe.close()
    mysqlOk = true
  }
  catch {
    mysqlOk = false
  }
}

// A REAL Postgres server (the `pg` driver), separate from the in-process pglite.
// Same external-persistent handling as MySQL — drop tables on connect (CASCADE to
// ignore FK order). Joins the suite when POSTGRES_URL is reachable; otherwise
// pglite already covers the Postgres dialect.
const POSTGRES_URL = process.env.POSTGRES_URL

async function connectPg(): Promise<Connection> {
  const conn = await createConnection({ driver: 'pg', url: POSTGRES_URL! })
  for (const t of await listTables(conn)) await conn.unprepared(`DROP TABLE IF EXISTS "${t}" CASCADE`)
  return conn
}

let pgOk = false
if (POSTGRES_URL) {
  try {
    const probe = await createConnection({ driver: 'pg', url: POSTGRES_URL })
    await probe.close()
    pgOk = true
  }
  catch {
    pgOk = false
  }
}

const registry: Record<string, Dialect | null> = {
  sqlite: base[0]!,
  pglite: base[1]!,
  pg: pgOk ? { name: 'pg', connect: connectPg } : null,
  mysql: mysqlOk ? { name: 'mysql', connect: connectMysql } : null,
}

// By default run every AVAILABLE dialect — sqlite + pglite (in-process, always),
// plus a real Postgres server (`pg`) when POSTGRES_URL is reachable and MySQL
// when MYSQL_URL is. So a plain `bun test` (with those URLs in a gitignored .env)
// covers them all. Narrow with `TEST_DIALECTS` (comma-separated), e.g.
// `TEST_DIALECTS=sqlite` for a quick run — running every dialect from inside
// `packages/database` (rather than the repo root) can exhaust pglite's WASM memory.
const available = ['sqlite', 'pglite', ...(pgOk ? ['pg'] : []), ...(mysqlOk ? ['mysql'] : [])]
const requested = process.env.TEST_DIALECTS
  ? process.env.TEST_DIALECTS.split(',').map(s => s.trim()).filter(Boolean)
  : available

/** Dialects the Active Record suite runs against. */
export const dialects: readonly Dialect[] = requested
  .map(name => registry[name])
  .filter((d): d is Dialect => d != null)
