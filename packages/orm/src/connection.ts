import { Database } from 'bun:sqlite'
import type { SQL } from 'drizzle-orm'
import { drizzle as drizzleSqlite } from 'drizzle-orm/bun-sqlite'

/**
 * SQL dialect. `sqlite` and `pg` differ in a few system queries (used by the
 * migrator); everything else in the query layer is shared. `pglite` is a
 * `pg`-dialect connection backed by an embedded Postgres.
 */
export type Dialect = 'sqlite' | 'pg'

/**
 * A dialect-agnostic database handle. The model layer talks to `db` (a Drizzle
 * instance) purely through awaitable query builders; the migrator uses
 * `execute`/`all` for raw SQL.
 *
 * `db` is intentionally loosely typed here — Drizzle's per-dialect generics are
 * incompatible as a union, so the query builder is used structurally. The
 * developer-facing model API stays typed via the table's inferred types.
 */
export interface Connection {
  readonly dialect: Dialect
  // biome-ignore lint/suspicious/noExplicitAny: cross-dialect Drizzle handle used structurally
  readonly db: any
  /** Run a statement for its side effect (DDL, writes). */
  execute(query: SQL): Promise<void>
  /** Run a query and return its rows. */
  all<T = Record<string, unknown>>(query: SQL): Promise<T[]>
  /** Close the underlying client. */
  close(): Promise<void>
}

export interface SqliteConnectionConfig {
  driver: 'sqlite'
  /** File path, or `:memory:` for an ephemeral database. */
  database: string
}

export interface PostgresConnectionConfig {
  driver: 'pg'
  /** Postgres connection string, e.g. `postgres://user:pass@host:5432/db`. */
  url: string
}

export interface PgliteConnectionConfig {
  driver: 'pglite'
  /** Data directory; omit (or `:memory:`) for an in-memory embedded Postgres. */
  dataDir?: string
}

export type ConnectionConfig =
  | SqliteConnectionConfig
  | PostgresConnectionConfig
  | PgliteConnectionConfig

/** Build a {@link Connection} for the configured driver. */
export async function createConnection(config: ConnectionConfig): Promise<Connection> {
  switch (config.driver) {
    case 'sqlite': {
      const raw = new Database(config.database, { create: true })
      raw.exec('PRAGMA journal_mode = WAL;')
      raw.exec('PRAGMA foreign_keys = ON;')
      const db = drizzleSqlite(raw)
      return {
        dialect: 'sqlite',
        db,
        execute: async (query) => {
          db.run(query)
        },
        all: async (query) => db.all(query) as never[],
        close: async () => {
          raw.close()
        },
      }
    }

    case 'pglite': {
      const { PGlite } = await import('@electric-sql/pglite')
      const { drizzle } = await import('drizzle-orm/pglite')
      const client = new PGlite(config.dataDir === ':memory:' ? undefined : config.dataDir)
      const db = drizzle(client)
      return {
        dialect: 'pg',
        db,
        execute: async (query) => {
          await db.execute(query)
        },
        all: async (query) => (await db.execute(query)).rows as never[],
        close: async () => {
          await client.close()
        },
      }
    }

    case 'pg': {
      const { default: postgres } = await import('postgres')
      const { drizzle } = await import('drizzle-orm/postgres-js')
      const client = postgres(config.url)
      const db = drizzle(client)
      return {
        dialect: 'pg',
        db,
        execute: async (query) => {
          await db.execute(query)
        },
        // postgres-js returns the rows directly (a RowList array).
        all: async (query) => (await db.execute(query)) as never[],
        close: async () => {
          await client.end()
        },
      }
    }
  }
}

/**
 * Process-wide default connection, set at boot by the DatabaseServiceProvider.
 * Models resolve their handle from here (mirrors Laravel's default connection).
 */
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
      '[elysia-ravel] No database connection. Register DatabaseServiceProvider (config/database.ts).',
    )
  }
  return current
}

/** The Drizzle handle of the default connection (used by models). */
export function useDatabase(): Connection['db'] {
  return useConnection().db
}
