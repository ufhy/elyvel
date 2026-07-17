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
// MYSQL_URL points at a reachable server (e.g. `MYSQL_URL=mysql://root:pw@localhost/ravel_test`),
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

const registry: Record<string, Dialect | null> = {
  sqlite: base[0]!,
  pglite: base[1]!,
  mysql: mysqlOk ? { name: 'mysql', connect: connectMysql } : null,
}

// Which dialects to run, via `TEST_DIALECTS` (comma-separated). Default is
// sqlite + pglite (both in-process). MySQL runs as a SEPARATE pass —
// `TEST_DIALECTS=mysql MYSQL_URL=… bun test` — because co-loading it with
// pglite's WASM instances in one process exhausts memory.
const requested = (process.env.TEST_DIALECTS ?? 'sqlite,pglite')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

/** Dialects the Active Record suite runs against. */
export const dialects: readonly Dialect[] = requested
  .map(name => registry[name])
  .filter((d): d is Dialect => d != null)
