import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { ServiceProvider } from '@elysia-ravel/core'
import { type ConnectionConfig, createConnection, setConnection } from './connection'
import { DatabaseToken } from './tokens'

/**
 * Boots the default database connection from `config/database.ts`:
 *
 * ```ts
 * export default defineDatabaseConfig({
 *   default: 'sqlite',
 *   connections: {
 *     sqlite: { driver: 'sqlite', database: 'database/database.sqlite' },
 *     pg:     { driver: 'pg', url: process.env.DATABASE_URL! },
 *   },
 * })
 * ```
 *
 * Switching databases is just changing `default` (or the `DATABASE_URL`). The
 * connection is bound to the container ({@link DatabaseToken}) and set as the
 * default used by models.
 */
export class DatabaseServiceProvider extends ServiceProvider {
  override async register(): Promise<void> {
    const name = this.app.config.get<string>('database.default', 'sqlite')
    const config = this.app.config.get<ConnectionConfig | undefined>(
      `database.connections.${name}`,
    )

    if (!config) {
      throw new Error(
        `[elysia-ravel] Database connection "${name}" is not defined in config/database.ts.`,
      )
    }

    const connection = await createConnection(this.resolvePaths(config))
    setConnection(connection)
    this.app.container.instance(DatabaseToken, connection)
  }

  /** Resolve relative on-disk paths (sqlite file / pglite dir) against app root. */
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
