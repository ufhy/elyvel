import type { Dialect, Grammar } from './grammar'
import { AsyncLocalStorage } from 'node:async_hooks'
import { Database } from 'bun:sqlite'
import { grammarFor } from './grammar'

/**
 * A dialect-agnostic connection. Query/schema builders and models talk to
 * `select`/`statement` with parameter bindings; the {@link Grammar} renders
 * dialect-correct SQL. Swapping databases is a config change, not a rewrite.
 */
export interface QueryLogEntry {
  sql: string
  bindings: unknown[]
  ms: number
}

/** A query that finished executing — the payload passed to {@link Connection.onQuery}. */
export type QueryExecuted = QueryLogEntry
export type QueryListener = (event: QueryExecuted) => void

/** A query that threw — the payload passed to {@link Connection.onQueryError}. */
export interface QueryErrored extends QueryExecuted {
  error: unknown
}
export type QueryErrorListener = (event: QueryErrored) => void

/** Positional (`?`/`$n`) or named (`:name`) bindings. */
export type Bindings = unknown[] | Record<string, unknown>

export interface Connection {
  readonly dialect: Dialect
  readonly grammar: Grammar
  select<T = Record<string, unknown>>(sql: string, bindings?: Bindings): Promise<T[]>
  statement(sql: string, bindings?: Bindings): Promise<void>
  /** Run raw SQL with no bindings (e.g. multi-statement DDL), à la `DB::unprepared`. */
  unprepared(sql: string): Promise<void>
  /**
   * Run an INSERT and return the new auto-increment id. Only present on
   * RETURNING-less dialects (MySQL) — the query builder uses it to emulate
   * `INSERT ... RETURNING`. Returns `null` when the row had no generated id.
   */
  insertGetId?(sql: string, bindings?: Bindings): Promise<number | bigint | null>
  close(): Promise<void>
  /** Start recording executed queries. */
  enableQueryLog(): void
  disableQueryLog(): void
  /** Recorded queries (sql, bindings, elapsed ms) since logging was enabled. */
  getQueryLog(): QueryLogEntry[]
  flushQueryLog(): void
  /**
   * Register a listener fired after each successful query (à la Laravel's
   * `DB::listen`). Returns an unsubscribe function.
   */
  onQuery(listener: QueryListener): () => void
  /**
   * Register a listener fired when a query throws (with `sql`, `bindings`, and
   * the `error`). The error is still re-thrown afterwards. Returns an
   * unsubscribe function.
   */
  onQueryError(listener: QueryErrorListener): () => void
  /**
   * Fire `callback` once the cumulative query time (ms) since the last reset
   * crosses `threshold` — for slow-request alerts (à la Laravel's
   * `DB::whenQueryingForLongerThan`). Returns an unsubscribe function.
   */
  whenQueryingForLongerThan(threshold: number, callback: QueryListener): () => void
  /** Total accumulated query time (ms) since the last reset. */
  getTotalQueryDuration(): number
  /** Reset the cumulative query-time counter (typically per request). */
  resetTotalQueryDuration(): void
  /** Begin a transaction, or a nested SAVEPOINT if one is already open. */
  beginTransaction(): Promise<void>
  /** Commit the current transaction level (COMMIT at the outermost). */
  commit(): Promise<void>
  /** Roll back the current level (to the SAVEPOINT when nested, else full ROLLBACK). */
  rollBack(): Promise<void>
  /** Current transaction nesting depth (0 = no open transaction). */
  transactionLevel(): number
  /**
   * Run `callback` after the outermost transaction commits. If no transaction
   * is open, it runs immediately. Discarded on rollback. (à la Laravel's
   * `DB::afterCommit` / `dispatch()->afterCommit()`.)
   */
  afterCommit(callback: () => void | Promise<void>): void
}

export interface SqliteConnectionConfig {
  driver: 'sqlite'
  database: string
  /** Read replica(s). Reads route here; writes to {@link write}. */
  read?: { database: string }
  /** Write host. Falls back to the base config when omitted. */
  write?: { database: string }
  /** After a write in a request, route that request's reads to the write host. */
  sticky?: boolean
}
export interface PostgresConnectionConfig {
  driver: 'pg'
  url: string
  /** Read replica(s). Reads route here (round-robin if several); writes to {@link write}. */
  read?: { url: string } | { url: string }[]
  /** Write host. Falls back to the base config when omitted. */
  write?: { url: string }
  /** After a write in a request, route that request's reads to the write host. */
  sticky?: boolean
}
export interface PgliteConnectionConfig {
  driver: 'pglite'
  dataDir?: string
  read?: { dataDir?: string }
  write?: { dataDir?: string }
  sticky?: boolean
}
/** A MySQL host: a connection URL, or discrete fields (URL wins when both given). */
export interface MysqlHostConfig {
  url?: string
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
}
export interface MysqlConnectionConfig extends MysqlHostConfig {
  driver: 'mysql'
  /** Read replica(s). Reads route here (round-robin if several); writes to {@link write}. */
  read?: MysqlHostConfig | MysqlHostConfig[]
  /** Write host. Falls back to the base config when omitted. */
  write?: MysqlHostConfig
  /** After a write in a request, route that request's reads to the write host. */
  sticky?: boolean
}
export type ConnectionConfig
  = | SqliteConnectionConfig
    | PostgresConnectionConfig
    | PgliteConnectionConfig
    | MysqlConnectionConfig

/** Connections opened via createConnection, tracked so tests can close them all. */
const opened: Connection[] = []

/** Per-request state for read/write `sticky` routing. */
const requestStore = new AsyncLocalStorage<{ hadWrite: boolean }>()

/**
 * Open a fresh per-request scope for `sticky` read/write routing. Call once at
 * the start of each request (the `EloquentServiceProvider` wires this into the
 * HTTP lifecycle when a connection is configured `sticky`).
 */
export function startRequestScope(): void {
  requestStore.enterWith({ hadWrite: false })
}

export async function createConnection(config: ConnectionConfig): Promise<Connection> {
  const base = hasReadWrite(config)
    ? composeReadWrite(
        await buildConnection(mergeConfig(config, pickRead(config.read))),
        await buildConnection(mergeConfig(config, config.write)),
        Boolean(config.sticky),
      )
    : await buildConnection(config)
  const connection = withQueryLog(base)
  opened.push(connection)
  return connection
}

type RawConnection = Pick<
  Connection,
  'dialect' | 'grammar' | 'select' | 'statement' | 'unprepared' | 'close' | 'insertGetId'
>

type ConfigOverride = Record<string, unknown> | undefined

function hasReadWrite(config: ConnectionConfig): config is ConnectionConfig & {
  read?: ConfigOverride | ConfigOverride[]
  write?: ConfigOverride
} {
  return Boolean((config as { read?: unknown }).read ?? (config as { write?: unknown }).write)
}

/** Round-robin a read override across replicas (or pass a single one through). */
function pickRead(read: ConfigOverride | ConfigOverride[]): ConfigOverride {
  if (!Array.isArray(read))
    return read
  if (read.length === 0)
    return undefined
  return read[Math.floor(Math.random() * read.length)]
}

/** Base config minus read/write keys, with the given override merged on top. */
function mergeConfig(config: ConnectionConfig, override: ConfigOverride): ConnectionConfig {
  const { read: _r, write: _w, ...base } = config as unknown as Record<string, unknown>
  return { ...base, ...(override ?? {}) } as unknown as ConnectionConfig
}

const firstKeyword = (sql: string) => sql.trimStart().split(/\s+/, 1)[0]?.toUpperCase() ?? ''

/**
 * Normalize bindings to positional form. Array bindings pass through; a plain
 * object rewrites `:name` placeholders to the grammar's positional placeholder
 * (`?` / `$n`) in order of appearance.
 */
function bindNamed(
  sql: string,
  bindings: Bindings,
  grammar: Grammar,
): { sql: string, bindings: unknown[] } {
  if (Array.isArray(bindings))
    return { sql, bindings }
  const positional: unknown[] = []
  const rewritten = sql.replace(/:(\w+)/g, (_match, name: string) => {
    positional.push(bindings[name])
    return grammar.placeholder(positional.length - 1)
  })
  return { sql: rewritten, bindings: positional }
}

/**
 * Compose a read replica and a write host into one connection: `select` uses the
 * read host, `statement` (writes, DDL) uses the write host. Inside a transaction
 * reads route to the write host too, so a query sees its own uncommitted writes.
 */
function composeReadWrite(
  read: RawConnection,
  write: RawConnection,
  sticky: boolean,
): RawConnection {
  let txSticky = false // reads route to write for the duration of a transaction
  const markWrite = () => {
    if (sticky) {
      const store = requestStore.getStore()
      if (store)
        store.hadWrite = true
    }
  }
  const useWrite = () => txSticky || (sticky && requestStore.getStore()?.hadWrite === true)
  return {
    dialect: write.dialect,
    grammar: write.grammar,
    select: (sql, bindings) => (useWrite() ? write : read).select(sql, bindings),
    statement: async (sql, bindings) => {
      const kw = firstKeyword(sql)
      if (kw === 'BEGIN')
        txSticky = true
      markWrite()
      await write.statement(sql, bindings)
      // A `ROLLBACK TO SAVEPOINT` unwinds a nested level — the transaction is
      // still open, so keep routing reads to the write host.
      const endsTransaction
        = kw === 'COMMIT' || (kw === 'ROLLBACK' && !/^ROLLBACK\s+TO\b/i.test(sql.trimStart()))
      if (endsTransaction)
        txSticky = false
    },
    unprepared: (sql) => {
      markWrite()
      return write.unprepared(sql)
    },
    insertGetId: write.insertGetId
      ? (sql, bindings) => {
          markWrite()
          return write.insertGetId!(sql, bindings)
        }
      : undefined,
    close: async () => {
      await Promise.all([read.close(), write.close()])
    },
  }
}

/** Wrap select/statement to time queries, record a log, and notify listeners. */
function withQueryLog(base: RawConnection): Connection {
  let logging = false
  const log: QueryLogEntry[] = []
  const listeners = new Set<QueryListener>()
  const errorListeners = new Set<QueryErrorListener>()
  const slow: { threshold: number, callback: QueryListener, fired: boolean }[] = []
  let totalDuration = 0

  const round = (n: number) => Math.round(n * 100) / 100

  const record = async <T>(sql: string, bindings: unknown[], run: () => Promise<T>): Promise<T> => {
    const start = performance.now()
    let result: T
    try {
      result = await run()
    }
    catch (error) {
      const ms = round(performance.now() - start)
      for (const listener of errorListeners) listener({ sql, bindings, ms, error })
      throw error
    }
    const ms = round(performance.now() - start)
    const event: QueryExecuted = { sql, bindings, ms }

    if (logging)
      log.push(event)
    for (const listener of listeners) listener(event)

    totalDuration = round(totalDuration + ms)
    for (const s of slow) {
      if (!s.fired && totalDuration >= s.threshold) {
        s.fired = true
        s.callback(event)
      }
    }
    return result
  }

  const stmt = (sql: string, bindings: unknown[] = []) =>
    record(sql, bindings, () => base.statement(sql, bindings))

  let level = 0
  const afterCommitCallbacks: Array<() => void | Promise<void>> = []

  return {
    dialect: base.dialect,
    grammar: base.grammar,
    select: (sql, bindings = []) => {
      const b = bindNamed(sql, bindings, base.grammar)
      return record(b.sql, b.bindings, () => base.select(b.sql, b.bindings))
    },
    statement: (sql, bindings = []) => {
      const b = bindNamed(sql, bindings, base.grammar)
      return stmt(b.sql, b.bindings)
    },
    unprepared: sql => record(sql, [], () => base.unprepared(sql)),
    insertGetId: base.insertGetId
      ? (sql, bindings = []) => {
          const b = bindNamed(sql, bindings, base.grammar)
          return record(b.sql, b.bindings, () => base.insertGetId!(b.sql, b.bindings))
        }
      : undefined,
    close: () => base.close(),
    enableQueryLog: () => {
      logging = true
    },
    disableQueryLog: () => {
      logging = false
    },
    getQueryLog: () => [...log],
    flushQueryLog: () => {
      log.length = 0
    },
    onQuery: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    onQueryError: (listener) => {
      errorListeners.add(listener)
      return () => errorListeners.delete(listener)
    },
    whenQueryingForLongerThan: (threshold, callback) => {
      const entry = { threshold, callback, fired: false }
      slow.push(entry)
      return () => {
        const i = slow.indexOf(entry)
        if (i >= 0)
          slow.splice(i, 1)
      }
    },
    getTotalQueryDuration: () => totalDuration,
    resetTotalQueryDuration: () => {
      totalDuration = 0
      for (const s of slow) s.fired = false
    },
    beginTransaction: async () => {
      if (level === 0)
        await stmt('BEGIN')
      else await stmt(`SAVEPOINT trans${level + 1}`)
      level++
    },
    commit: async () => {
      if (level <= 1)
        await stmt('COMMIT') // nested commits fold into the outermost
      level = Math.max(0, level - 1)
      if (level === 0 && afterCommitCallbacks.length > 0) {
        const callbacks = afterCommitCallbacks.splice(0)
        for (const cb of callbacks) await cb()
      }
    },
    rollBack: async () => {
      if (level <= 1) {
        await stmt('ROLLBACK')
        level = 0
        afterCommitCallbacks.length = 0 // discard pending after-commit work
      }
      else {
        await stmt(`ROLLBACK TO SAVEPOINT trans${level}`)
        level--
      }
    },
    transactionLevel: () => level,
    afterCommit: (callback) => {
      if (level === 0) {
        void callback()
      }
      else {
        afterCommitCallbacks.push(callback)
      }
    },
  }
}

/** Close every connection opened via {@link createConnection} and reset state. */
export async function closeAllConnections(): Promise<void> {
  for (const connection of opened.splice(0)) {
    try {
      await connection.close()
    }
    catch {
      // ignore — best-effort cleanup
    }
  }
  connections.clear()
  current = null
}

async function buildConnection(config: ConnectionConfig): Promise<RawConnection> {
  switch (config.driver) {
    case 'sqlite': {
      const db = new Database(config.database, { create: true })
      db.exec('PRAGMA journal_mode = WAL;')
      db.exec('PRAGMA foreign_keys = ON;')
      return {
        dialect: 'sqlite',
        grammar: grammarFor('sqlite'),
        select: async (sql, bindings = []) =>
          db.query(sql).all(...(bindings as never[])) as never[],
        statement: async (sql, bindings = []) => {
          db.query(sql).run(...(bindings as never[]))
        },
        unprepared: async (sql) => {
          db.exec(sql)
        },
        close: async () => {
          db.close()
        },
      }
    }

    case 'pglite': {
      const { PGlite } = await import('@electric-sql/pglite')
      const client = new PGlite(config.dataDir === ':memory:' ? undefined : config.dataDir)
      return {
        dialect: 'pg',
        grammar: grammarFor('pg'),
        select: async (sql, bindings = []) =>
          (await client.query(sql, bindings as unknown[])).rows as never[],
        statement: async (sql, bindings = []) => {
          await client.query(sql, bindings as unknown[])
        },
        unprepared: async (sql) => {
          await client.exec(sql)
        },
        close: async () => {
          await client.close()
        },
      }
    }

    case 'pg': {
      // postgres-js is an optional peer; only required when the pg driver is used.
      const { default: postgres } = await import('postgres')
      // max:1 — our Connection is a single logical connection: BEGIN/…/COMMIT must
      // run on the SAME socket. With a pool, transaction statements would scatter
      // across connections (and postgres-js rejects unsafe BEGIN unless max:1).
      // Parse the URL into explicit fields (à la mysql) rather than handing the raw
      // string to postgres-js: an unencoded char in the password makes its lenient
      // URL parser silently drop the username and fall back to the OS user — a
      // baffling `role "<you>" does not exist`. Explicit fields can't be dropped.
      const client = postgres({ ...pgClientOptions(config.url), max: 1 })
      return {
        dialect: 'pg',
        grammar: grammarFor('pg'),
        select: async (sql, bindings = []) => client.unsafe(sql, bindings as never[]) as never,
        statement: async (sql, bindings = []) => {
          await client.unsafe(sql, bindings as never[])
        },
        unprepared: async (sql) => {
          await client.unsafe(sql)
        },
        close: async () => {
          await client.end()
        },
      }
    }

    case 'mysql': {
      // kysely + mysql2 are optional peers; only required when the mysql driver is used.
      const { createPool } = await import('mysql2')
      const { CompiledQuery, Kysely, MysqlDialect } = await import('kysely')
      const pool = createPool({
        ...mysqlPoolOptions(config),
        // One physical connection: BEGIN/…/COMMIT and LAST_INSERT_ID() are
        // session-scoped and must not scatter across a pool (à la pg's max:1).
        connectionLimit: 1,
        // Map TINYINT(1) → boolean so our boolean columns round-trip cleanly.
        typeCast(field, next) {
          if (field.type === 'TINY' && field.length === 1)
            return field.string() === '1'
          return next()
        },
      })
      const db = new Kysely<Record<string, never>>({ dialect: new MysqlDialect({ pool }) })
      const run = (sql: string, bindings: unknown[] = []) =>
        db.executeQuery(CompiledQuery.raw(sql, bindings))
      return {
        dialect: 'mysql',
        grammar: grammarFor('mysql'),
        select: async (sql, bindings = []) => (await run(sql, bindings as unknown[])).rows as never,
        statement: async (sql, bindings = []) => {
          await run(sql, bindings as unknown[])
        },
        unprepared: async (sql) => {
          await run(sql)
        },
        insertGetId: async (sql, bindings = []) => {
          const { insertId } = await run(sql, bindings as unknown[])
          return insertId === undefined ? null : (insertId as bigint)
        },
        close: async () => {
          await db.destroy()
        },
      }
    }
  }
}

/**
 * postgres-js connection options from a `postgres://` URL. Parsed with the strict
 * WHATWG URL parser so a malformed/unencoded password fails loudly here instead of
 * silently degrading to the OS user inside postgres-js.
 */
function pgClientOptions(url: string): Record<string, unknown> {
  let u: URL
  try {
    u = new URL(url)
  }
  catch {
    throw new Error(
      `[database] Invalid Postgres URL. If the password contains characters like @ / : # ? they must be percent-encoded (e.g. @ → %40). Got: ${url.replace(/:[^:@/]*@/, ':****@')}`,
    )
  }
  return {
    host: u.hostname || 'localhost',
    port: u.port ? Number(u.port) : 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  }
}

/** mysql2 pool options from a MySQL connection config (a URL overrides discrete fields). */
function mysqlPoolOptions(config: MysqlConnectionConfig): Record<string, unknown> {
  if (config.url) {
    const u = new URL(config.url)
    return {
      host: u.hostname || 'localhost',
      port: u.port ? Number(u.port) : 3306,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ''),
      // Allow `unprepared` multi-statement DDL (à la `DB::unprepared`).
      multipleStatements: true,
    }
  }
  return {
    host: config.host ?? 'localhost',
    port: config.port ?? 3306,
    user: config.user,
    password: config.password,
    database: config.database,
    multipleStatements: true,
  }
}

/** Process-wide default connection, set at boot by the DatabaseServiceProvider. */
const connections = new Map<string, Connection>()
let current: Connection | null = null

/** Register a connection under `name` (the first/`default` becomes the default). */
export function setConnection(connection: Connection, name = 'default'): void {
  connections.set(name, connection)
  if (name === 'default' || current === null)
    current = connection
}
export function hasConnection(name?: string): boolean {
  return name ? connections.has(name) : current !== null
}
/** Resolve the default connection, or a named one when `name` is given. */
export function useConnection(name?: string): Connection {
  const connection = name ? connections.get(name) : current
  if (!connection) {
    throw new Error(
      `[elyvel] No database connection${name ? ` "${name}"` : ''}. Register EloquentServiceProvider (config/database.ts).`,
    )
  }
  return connection
}

/** Postgres/SQLite deadlock or serialization failures worth retrying. */
function causedByConcurrencyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /deadlock|serializ|database is locked|SQLITE_BUSY|40001|40P01/i.test(message)
}

/**
 * Run `callback` inside a transaction on the default connection: COMMIT on
 * success, ROLLBACK on any thrown error. Nested calls use SAVEPOINTs. Set
 * `attempts > 1` to retry the whole transaction on deadlock/serialization errors.
 */
export async function transaction<T>(callback: () => Promise<T>, attempts = 1): Promise<T> {
  const connection = useConnection()
  for (let attempt = 1; ; attempt++) {
    await connection.beginTransaction()
    try {
      const result = await callback()
      await connection.commit()
      return result
    }
    catch (error) {
      await connection.rollBack()
      if (attempt < attempts && causedByConcurrencyError(error))
        continue
      throw error
    }
  }
}

/** Manually begin a transaction (or nested SAVEPOINT) on the default connection. */
export function beginTransaction(): Promise<void> {
  return useConnection().beginTransaction()
}
/** Commit the current transaction level on the default connection. */
export function commit(): Promise<void> {
  return useConnection().commit()
}
/** Roll back the current transaction level on the default connection. */
export function rollBack(): Promise<void> {
  return useConnection().rollBack()
}
/**
 * Run `callback` after the outermost transaction commits (immediately if none
 * is open) on the default connection — à la Laravel's `DB::afterCommit`.
 */
export function afterCommit(callback: () => void | Promise<void>): void {
  useConnection().afterCommit(callback)
}

/** Run a raw SQL query on the default connection and return rows. */
export async function raw<T = Record<string, unknown>>(
  sql: string,
  bindings: Bindings = [],
): Promise<T[]> {
  return useConnection().select<T>(sql, bindings)
}

/** Run a raw SQL statement (no result set) on the default connection. */
export async function rawStatement(sql: string, bindings: Bindings = []): Promise<void> {
  return useConnection().statement(sql, bindings)
}

/** Run raw SQL with no bindings (e.g. multi-statement DDL) on the default connection. */
export async function unprepared(sql: string): Promise<void> {
  return useConnection().unprepared(sql)
}
