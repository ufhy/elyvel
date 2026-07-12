import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { ServiceProvider } from '@elysia-ravel/core'
import { type ConnectionConfig, createConnection, setConnection } from './connection'
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

    const appKey = this.app.config.get<string | undefined>('app.key')
    if (appKey) setEncryptionKey(appKey)
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
