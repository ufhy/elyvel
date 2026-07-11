import type { ConnectionConfig } from './connection'

/**
 * Shape of `config/database.ts`. Author it with {@link defineDatabaseConfig}
 * for autocomplete + typo-safety. Each connection is a discriminated union on
 * `driver` (`sqlite` | `pg` | `pglite`).
 */
export interface DatabaseConfig {
  default: string
  connections: Record<string, ConnectionConfig>
}

export function defineDatabaseConfig(config: DatabaseConfig): DatabaseConfig {
  return config
}
