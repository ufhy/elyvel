import { defineDatabaseConfig } from '@elysia-ravel/orm'

/**
 * Database config. Switch databases by changing `default` (or `DB_CONNECTION`)
 * — no application code changes. Each connection is typed per `driver`.
 */
export default defineDatabaseConfig({
  default: process.env.DB_CONNECTION ?? 'sqlite',
  connections: {
    sqlite: { driver: 'sqlite', database: 'database/database.sqlite' },
    // Embedded Postgres (WASM) — real PG, zero server:
    pglite: { driver: 'pglite', dataDir: 'database/pglite' },
    // A real Postgres server:
    pg: { driver: 'pg', url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/app' },
  },
})
