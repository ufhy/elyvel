import type { Connection } from './connection'

/** A column as reported by the database's own catalog. */
export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  default: string | null
}

const IDENTIFIER = /^\w+$/
function assertIdentifier(name: string): void {
  if (!IDENTIFIER.test(name))
    throw new Error(`[eloquent] Unsafe table name: ${name}`)
}

/** List user tables (excludes internal/system tables), sorted by name. */
export async function listTables(conn: Connection): Promise<string[]> {
  if (conn.dialect === 'sqlite') {
    const rows = await conn.select<{ name: string }>(
      'SELECT name FROM sqlite_master WHERE type = \'table\' AND name NOT LIKE \'sqlite_%\' ORDER BY name',
    )
    return rows.map(r => r.name)
  }
  const schema = conn.dialect === 'mysql' ? 'DATABASE()' : '\'public\''
  // Alias explicitly: MySQL returns unaliased information_schema columns uppercased.
  const rows = await conn.select<{ table_name: string }>(
    `SELECT table_name AS table_name FROM information_schema.tables WHERE table_schema = ${schema} AND table_type = 'BASE TABLE' ORDER BY table_name`,
  )
  return rows.map(r => r.table_name)
}

/** Describe a table's columns via the database catalog. */
export async function tableColumns(conn: Connection, table: string): Promise<ColumnInfo[]> {
  if (conn.dialect === 'sqlite') {
    assertIdentifier(table) // PRAGMA can't be parameterized
    const rows = await conn.select<{
      name: string
      type: string
      notnull: number
      dflt_value: string | null
    }>(`PRAGMA table_info(${table})`)
    return rows.map(r => ({
      name: r.name,
      type: r.type || 'TEXT',
      nullable: r.notnull === 0,
      default: r.dflt_value,
    }))
  }
  const schemaFilter = conn.dialect === 'mysql' ? ' AND table_schema = DATABASE()' : ''
  const rows = await conn.select<{
    column_name: string
    data_type: string
    is_nullable: string
    column_default: string | null
  }>(
    `SELECT column_name AS column_name, data_type AS data_type, is_nullable AS is_nullable, column_default AS column_default FROM information_schema.columns WHERE table_name = :table${schemaFilter} ORDER BY ordinal_position`,
    { table },
  )
  return rows.map(r => ({
    name: r.column_name,
    type: r.data_type,
    nullable: r.is_nullable === 'YES',
    default: r.column_default,
  }))
}

/** Row count for a single table. */
export async function countRows(conn: Connection, table: string): Promise<number> {
  assertIdentifier(table)
  const rows = await conn.select<{ n: number | string }>(`SELECT count(*) AS n FROM ${table}`)
  return Number(rows[0]?.n ?? 0)
}

/** Number of open connections (Postgres/MySQL only; `null` for SQLite). */
export async function openConnectionCount(conn: Connection): Promise<number | null> {
  if (conn.dialect === 'sqlite')
    return null
  const table = conn.dialect === 'mysql' ? 'information_schema.processlist' : 'pg_stat_activity'
  const rows = await conn.select<{ count: number | string }>(
    `SELECT count(*) AS count FROM ${table}`,
  )
  return Number(rows[0]?.count ?? 0)
}
