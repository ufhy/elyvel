import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { ServiceProvider } from '@elysia-ravel/core'
import {
  type Connection,
  type ConnectionConfig,
  createConnection,
  setConnection,
  startRequestScope,
} from './connection'
import { setEncryptionKey } from './crypto'
import { DatabaseToken } from './tokens'

/**
 * Boots the default Eloquent connection from `config/database.ts`. Switching
 * databases is just changing `default` (or the connection's config) — models
 * and migrations are unchanged. Binds the connection to {@link DatabaseToken}
 * and sets it as the default used by models.
 */
export class EloquentServiceProvider extends ServiceProvider {
  override async register(): Promise<void> {
    const name = this.app.config.get<string>('database.default', 'sqlite')
    const config = this.app.config.get<ConnectionConfig | undefined>(`database.connections.${name}`)
    if (!config) {
      throw new Error(
        `[elysia-ravel] Database connection "${name}" is not defined in config/database.ts.`,
      )
    }

    const connection = await createConnection(this.resolvePaths(config))
    setConnection(connection)
    this.app.container.instance(DatabaseToken, connection)

    const appKey = this.app.config.get<string | undefined>('app.key')
    if (appKey) setEncryptionKey(appKey)

    this.wireLogging(connection)

    // Open a per-request scope so read/write `sticky` routing is isolated per request.
    if ((config as { sticky?: boolean }).sticky) {
      this.app.elysia.onRequest(() => startRequestScope())
    }
  }

  /** Bridge the connection's query hooks into the app logger (à la `DB::listen`). */
  private wireLogging(connection: Connection): void {
    const sql = this.app.logger.child('sql')

    // Query errors are always logged with their SQL/bindings — the context you
    // need to trace a failure. The error is still re-thrown by the connection.
    connection.onQueryError(({ sql: query, bindings, ms, error }) => {
      sql.error('query failed', {
        sql: query,
        bindings,
        ms,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
    })

    // Per-query debug logging is opt-in (noisy).
    if (this.app.config.get<boolean>('database.log', false)) {
      connection.onQuery(({ sql: query, bindings, ms }) => {
        sql.debug(query, { bindings, ms })
      })
    }

    // Slow-request monitoring: warn when cumulative query time crosses the
    // threshold, reset per HTTP request. (Cumulative time is connection-wide,
    // so under heavy concurrency the figure is approximate.)
    const slowMs = this.app.config.get<number | undefined>('database.slowMs')
    if (slowMs && slowMs > 0) {
      connection.whenQueryingForLongerThan(slowMs, ({ ms }) => {
        sql.warn('slow request query time', {
          totalMs: connection.getTotalQueryDuration(),
          lastMs: ms,
        })
      })
      this.app.elysia.onRequest(() => connection.resetTotalQueryDuration())
    }
  }

  private resolvePaths(config: ConnectionConfig): ConnectionConfig {
    if (config.driver === 'sqlite' && config.database !== ':memory:') {
      const database = this.app.path(config.database)
      mkdirSync(dirname(database), { recursive: true })
      return { ...config, database }
    }
    if (config.driver === 'pglite' && config.dataDir && config.dataDir !== ':memory:') {
      const dataDir = this.app.path(config.dataDir)
      mkdirSync(dataDir, { recursive: true })
      return { ...config, dataDir }
    }
    return config
  }
}
