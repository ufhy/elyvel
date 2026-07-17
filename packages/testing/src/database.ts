import type { Connection, ConnectionConfig } from '@elysia-ravel/database'

export interface RefreshOptions {
  /** Connection to spin up. Defaults to an in-memory SQLite database. */
  connection?: ConnectionConfig
  /** Build the schema on the fresh connection (run migrations / create tables). */
  seed?(connection: Connection): Promise<void> | void
}

/**
 * Give each test a clean database: open a fresh connection, make it the default
 * (so models resolve to it), and run the `seed` callback to build the schema.
 * The default in-memory SQLite connection is discarded when it goes out of scope,
 * so tests are naturally isolated — Laravel's `RefreshDatabase`, minus the trait.
 *
 * `@elysia-ravel/database` is imported lazily so this package stays usable (for
 * the HTTP client alone) in projects that don't depend on the database layer.
 *
 * @example
 * beforeEach(async () => {
 *   await refreshDatabase({ seed: conn => new SchemaBuilder(conn).create('users', t => { t.id() }) })
 * })
 */
export async function refreshDatabase(options: RefreshOptions = {}): Promise<Connection> {
  const { createConnection, setConnection } = await import('@elysia-ravel/database')
  const connection = await createConnection(
    options.connection ?? { driver: 'sqlite', database: ':memory:' },
  )
  setConnection(connection)
  if (options.seed)
    await options.seed(connection)
  return connection
}
