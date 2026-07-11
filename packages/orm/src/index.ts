export {
  type Connection,
  type ConnectionConfig,
  createConnection,
  type Dialect,
  hasConnection,
  type PgliteConnectionConfig,
  type PostgresConnectionConfig,
  setConnection,
  type SqliteConnectionConfig,
  useConnection,
  useDatabase,
} from './connection'
export { type DatabaseConfig, defineDatabaseConfig } from './config-schema'
export { DatabaseServiceProvider } from './database-provider'
export { defineModel, type Model } from './model'
export { freshMigrate, loadMigrations, migrate, type Migration } from './migrator'
export { runSeeders, Seeder, type SeederClass } from './seeder'
export { DatabaseToken } from './tokens'

// SQLite schema builders (the default driver).
export { blob, integer, numeric, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
// Postgres schema builders, namespaced to avoid clashing with the SQLite ones:
//   import { pg } from '@elysia-ravel/orm'; pg.pgTable('users', { id: pg.serial(...) })
export * as pg from 'drizzle-orm/pg-core'
// Operators shared across dialects.
export { and, desc, eq, gt, gte, like, lt, lte, ne, or, sql } from 'drizzle-orm'
