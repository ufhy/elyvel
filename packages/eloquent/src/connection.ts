import { Database } from 'bun:sqlite'
import { type Dialect, type Grammar, grammarFor } from './grammar'

/**
 * A dialect-agnostic connection. Query/schema builders and models talk to
 * `select`/`statement` with parameter bindings; the {@link Grammar} renders
 * dialect-correct SQL. Swapping databases is a config change, not a rewrite.
 */
export interface Connection {
  readonly dialect: Dialect
  readonly grammar: Grammar
  select<T = Record<string, unknown>>(sql: string, bindings?: unknown[]): Promise<T[]>
  statement(sql: string, bindings?: unknown[]): Promise<void>
  close(): Promise<void>
}

export interface SqliteConnectionConfig {
  driver: 'sqlite'
  database: string
}
export interface PostgresConnectionConfig {
  driver: 'pg'
  url: string
}
export interface PgliteConnectionConfig {
  driver: 'pglite'
  dataDir?: string
}
export type ConnectionConfig =
  | SqliteConnectionConfig
  | PostgresConnectionConfig
  | PgliteConnectionConfig

export async function createConnection(config: ConnectionConfig): Promise<Connection> {
  switch (config.driver) {
    case 'sqlite': {
      const db = new Database(config.database, { create: true })
      db.exec('PRAGMA journal_mode = WAL;')
      db.exec('PRAGMA foreign_keys = ON;')
      return {
        dialect: 'sqlite',
        grammar: grammarFor('sqlite'),
        select: async (sql, bindings = []) =>
          db.query(sql).all(...(bindings as never[])) as never[],
        statement: async (sql, bindings = []) => {
          db.query(sql).run(...(bindings as never[]))
        },
        close: async () => {
          db.close()
        },
      }
    }

    case 'pglite': {
      const { PGlite } = await import('@electric-sql/pglite')
      const client = new PGlite(config.dataDir === ':memory:' ? undefined : config.dataDir)
      return {
        dialect: 'pg',
        grammar: grammarFor('pg'),
        select: async (sql, bindings = []) => (await client.query(sql, bindings)).rows as never[],
        statement: async (sql, bindings = []) => {
          await client.query(sql, bindings)
        },
        close: async () => {
          await client.close()
        },
      }
    }

    case 'pg': {
      // postgres-js is an optional peer; only required when the pg driver is used.
      const { default: postgres } = await import('postgres')
      const client = postgres(config.url)
      return {
        dialect: 'pg',
        grammar: grammarFor('pg'),
        select: async (sql, bindings = []) => client.unsafe(sql, bindings as never[]) as never,
        statement: async (sql, bindings = []) => {
          await client.unsafe(sql, bindings as never[])
        },
        close: async () => {
          await client.end()
        },
      }
    }
  }
}

/** Process-wide default connection, set at boot by the DatabaseServiceProvider. */
const connections = new Map<string, Connection>()
let current: Connection | null = null

/** Register a connection under `name` (the first/`default` becomes the default). */
export function setConnection(connection: Connection, name = 'default'): void {
  connections.set(name, connection)
  if (name === 'default' || current === null) current = connection
}
export function hasConnection(name?: string): boolean {
  return name ? connections.has(name) : current !== null
}
/** Resolve the default connection, or a named one when `name` is given. */
export function useConnection(name?: string): Connection {
  const connection = name ? connections.get(name) : current
  if (!connection) {
    throw new Error(
      `[elysia-ravel] No database connection${name ? ` "${name}"` : ''}. Register EloquentServiceProvider (config/database.ts).`,
    )
  }
  return connection
}

/**
 * Run `callback` inside a transaction on the default connection: BEGIN, then
 * COMMIT on success or ROLLBACK on any thrown error.
 */
export async function transaction<T>(callback: () => Promise<T>): Promise<T> {
  const connection = useConnection()
  await connection.statement('BEGIN')
  try {
    const result = await callback()
    await connection.statement('COMMIT')
    return result
  } catch (error) {
    await connection.statement('ROLLBACK')
    throw error
  }
}

/** Run a raw SQL query on the default connection and return rows. */
export async function raw<T = Record<string, unknown>>(
  sql: string,
  bindings: unknown[] = [],
): Promise<T[]> {
  return useConnection().select<T>(sql, bindings)
}

/** Run a raw SQL statement (no result set) on the default connection. */
export async function rawStatement(sql: string, bindings: unknown[] = []): Promise<void> {
  return useConnection().statement(sql, bindings)
}
