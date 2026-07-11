import type { ConnectionConfig } from './connection'

/**
 * Shape of `config/database.ts`. Author it with {@link defineDatabaseConfig}
 * for autocomplete and typo-safety. Each connection is a discriminated union
 * on `driver` (`sqlite` | `pg` | `pglite`), so editors only offer the fields
 * that driver actually needs.
 */
export interface DatabaseConfig {
  /** Name of the connection in `connections` to use by default. */
  default: string
  /** Named database connections. */
  connections: Record<string, ConnectionConfig>
}

/** Identity helper that pins the type of `config/database.ts`. */
export function defineDatabaseConfig(config: DatabaseConfig): DatabaseConfig {
  return config
}
