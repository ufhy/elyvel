import type { ConnectionConfig } from './connection'

/**
 * Shape of `config/database.ts`. Author it with {@link defineDatabaseConfig}
 * for autocomplete + typo-safety. Each connection is a discriminated union on
 * `driver` (`sqlite` | `pg` | `pglite`).
 */
export interface DatabaseConfig {
  default: string
  connections: Record<string, ConnectionConfig>
  /** Log every executed query to the `sql` channel at `debug` level. Default false. */
  log?: boolean
  /**
   * Warn (on the `sql` channel) when cumulative query time in a request exceeds
   * this many milliseconds. Omit to disable slow-query monitoring.
   */
  slowMs?: number
}

export function defineDatabaseConfig(config: DatabaseConfig): DatabaseConfig {
  return config
}
