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
let current: Connection | null = null

export function setConnection(connection: Connection): void {
  current = connection
}
export function hasConnection(): boolean {
  return current !== null
}
export function useConnection(): Connection {
  if (!current) {
    throw new Error(
      '[elysia-ravel] No database connection. Register EloquentServiceProvider (config/database.ts).',
    )
  }
  return current
}
