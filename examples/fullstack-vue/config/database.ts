import { defineDatabaseConfig } from '@elysia-ravel/database'

/**
 * Database config. Switch databases by changing `default` (or `DB_CONNECTION`)
 * — no application code changes.
 */
export default defineDatabaseConfig({
  default: process.env.DB_CONNECTION ?? 'sqlite',
  log: process.env.DB_LOG === 'true',
  connections: {
    sqlite: { driver: 'sqlite', database: 'database/database.sqlite' },
    pglite: { driver: 'pglite', dataDir: 'database/pglite' },
    pg: { driver: 'pg', url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/app' },
  },
})
