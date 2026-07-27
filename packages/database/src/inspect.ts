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

/** An index as reported by the database's own catalog. */
export interface IndexInfo {
  name: string
  columns: string[]
  unique: boolean
}

/** List a table's indexes (name, columns, uniqueness) via the database catalog. */
export async function tableIndexes(conn: Connection, table: string): Promise<IndexInfo[]> {
  if (conn.dialect === 'sqlite') {
    assertIdentifier(table) // PRAGMA can't be parameterized
    const idxList = await conn.select<{ name: string, unique: number }>(`PRAGMA index_list(${table})`)
    const result: IndexInfo[] = []
    for (const idx of idxList) {
      assertIdentifier(idx.name)
      const cols = await conn.select<{ name: string }>(`PRAGMA index_info(${idx.name})`)
      result.push({ name: idx.name, columns: cols.map(c => c.name), unique: idx.unique === 1 })
    }
    return result
  }
  const map = new Map<string, IndexInfo>()
  if (conn.dialect === 'mysql') {
    const rows = await conn.select<{ index_name: string, column_name: string, non_unique: number }>(
      `SELECT index_name AS index_name, column_name AS column_name, non_unique AS non_unique FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = :table ORDER BY index_name, seq_in_index`,
      { table },
    )
    for (const r of rows) {
      const entry = map.get(r.index_name) ?? { name: r.index_name, columns: [], unique: Number(r.non_unique) === 0 }
      entry.columns.push(r.column_name)
      map.set(r.index_name, entry)
    }
    return [...map.values()]
  }
  const rows = await conn.select<{ index_name: string, column_name: string, is_unique: boolean }>(
    `SELECT i.relname AS index_name, a.attname AS column_name, ix.indisunique AS is_unique
     FROM pg_class t
     JOIN pg_index ix ON t.oid = ix.indrelid
     JOIN pg_class i ON i.oid = ix.indexrelid
     JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
     WHERE t.relname = :table`,
    { table },
  )
  for (const r of rows) {
    const entry = map.get(r.index_name) ?? { name: r.index_name, columns: [], unique: Boolean(r.is_unique) }
    entry.columns.push(r.column_name)
    map.set(r.index_name, entry)
  }
  return [...map.values()]
}

/** `Schema::hasTable` — does this table exist? */
export async function hasTable(conn: Connection, table: string): Promise<boolean> {
  return (await listTables(conn)).includes(table)
}

/** `Schema::hasColumn` — does this table have this column? */
export async function hasColumn(conn: Connection, table: string, column: string): Promise<boolean> {
  return (await tableColumns(conn, table)).some(c => c.name === column)
}

/**
 * `Schema::hasIndex` — does an index (optionally a unique one) cover exactly
 * this column set, regardless of name?
 */
export async function hasIndex(
  conn: Connection,
  table: string,
  columns: string | string[],
  type?: 'unique',
): Promise<boolean> {
  const wanted = new Set(Array.isArray(columns) ? columns : [columns])
  const indexes = await tableIndexes(conn, table)
  return indexes.some((idx) => {
    if (type === 'unique' && !idx.unique)
      return false
    return idx.columns.length === wanted.size && idx.columns.every(c => wanted.has(c))
  })
}

/**
 * The name of the foreign-key constraint on this column, if any — MySQL
 * auto-generates one (e.g. `posts_ibfk_1`) with no fixed, reproducible
 * pattern, so dropping a FK'd column there means looking its real name up
 * first (`ALTER TABLE ... DROP COLUMN` alone fails with `ER_FK_COLUMN_CANNOT_DROP`).
 * Postgres/SQLite don't need this: Postgres cascades the constraint away when
 * the column is dropped, and SQLite can't drop a FK'd column at all (see
 * `dropUserstamps()`).
 */
export async function foreignKeyConstraintName(
  conn: Connection,
  table: string,
  column: string,
): Promise<string | null> {
  if (conn.dialect !== 'mysql')
    return null
  const rows = await conn.select<{ constraint_name: string }>(
    `SELECT constraint_name AS constraint_name FROM information_schema.key_column_usage
     WHERE table_schema = DATABASE() AND table_name = :table AND column_name = :column
       AND referenced_table_name IS NOT NULL`,
    { table, column },
  )
  return rows[0]?.constraint_name ?? null
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
