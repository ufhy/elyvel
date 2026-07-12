import { defineDatabaseConfig } from '@elysia-ravel/eloquent'

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
    // Read/write split — reads go to a replica, writes (and everything inside a
    // transaction) go to the primary. `read` may list several replicas:
    // pgSplit: {
    //   driver: 'pg',
    //   url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/app',
    //   write: { url: process.env.DB_WRITE_URL ?? 'postgres://primary:5432/app' },
    //   read: [{ url: 'postgres://replica-1:5432/app' }, { url: 'postgres://replica-2:5432/app' }],
    // },
  },
})
