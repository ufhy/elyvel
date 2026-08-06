/**
 * The elyvel MCP tools — each one a plain object with a zod schema and a
 * `handle` that returns text, so every tool is testable as a function without
 * an MCP client in sight. `server.ts` is the only file that knows the SDK.
 *
 * All tools run against ONE booted application (`McpContext.app`), the same
 * process the MCP server lives in — a tool never spawns `elyvel` again.
 */
import type { Application } from '@elyvel/core'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { buildTinkerSeed, createReplContext, evaluateLine } from '@elyvel/cli'
import { routeMetaEntries } from '@elyvel/core'
import { listLogFiles, readEntries } from '@elyvel/log-viewer'
import * as z from 'zod'
import { installedElyvelPackages } from './packages'

export interface McpContext {
  /** The booted application (routes loaded). */
  app: Application
  /** The app's root directory. */
  cwd: string
}

export interface McpTool {
  name: string
  description: string
  inputSchema: z.ZodObject<z.ZodRawShape>
  /** True when the tool cannot change anything — surfaced as `readOnlyHint`. */
  readOnly: boolean
  handle(args: Record<string, unknown>, ctx: McpContext): Promise<string>
}

/* -------------------------------------------------------------------------- */
/* application-info                                                           */
/* -------------------------------------------------------------------------- */

const applicationInfo: McpTool = {
  name: 'application-info',
  description:
    'Read the elyvel application\'s state: name/environment, Bun version, every installed @elyvel package with its exact version, the database connection in use, and the models in app/models. Call this before writing code that depends on package APIs or versions.',
  inputSchema: z.object({}),
  readOnly: true,
  async handle(_args, ctx) {
    const cfg = ctx.app.config
    const lines: string[] = [
      `Application: ${String(cfg.get('app.name', '(unnamed)'))}`,
      `Environment: ${String(cfg.get('app.env', 'local'))} (debug: ${String(cfg.get('app.debug', false))})`,
      `Bun: ${Bun.version}`,
    ]

    const packages = installedElyvelPackages(ctx.cwd)
    lines.push('', 'Installed @elyvel packages:')
    for (const { name, version } of packages)
      lines.push(`  ${name}@${version}`)

    const defaultConn = cfg.get<string>('database.default')
    if (defaultConn) {
      const connections = cfg.get<Record<string, { driver?: string }>>('database.connections', {}) ?? {}
      const driver = connections[defaultConn]?.driver ?? '(unknown driver)'
      lines.push('', `Database: connection "${defaultConn}" (${driver})`)
    }

    const models = modelNames(ctx.cwd)
    if (models.length > 0)
      lines.push('', `Models (app/models): ${models.join(', ')}`)

    return lines.join('\n')
  },
}

function modelNames(cwd: string): string[] {
  const dir = join(cwd, 'app', 'models')
  if (!existsSync(dir))
    return []
  return readdirSync(dir)
    .filter(f => f.endsWith('.ts') || f.endsWith('.js'))
    .map(f => f.replace(/\.(?:ts|js)$/, ''))
    .sort()
}

/* -------------------------------------------------------------------------- */
/* database tools                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Resolve `@elyvel/database` from the app, not from this package's own
 * dependency graph — we deliberately don't depend on it, so an app without a
 * database simply doesn't get these tools' data. Tokens are string-keyed, so
 * the app's copy and any other copy agree on `DatabaseToken`.
 */
async function databaseModule(cwd: string): Promise<Record<string, unknown> | null> {
  try {
    return (await import(Bun.resolveSync('@elyvel/database', cwd))) as Record<string, unknown>
  }
  catch {
    return null
  }
}

async function databaseConnection(ctx: McpContext): Promise<
  { db: Record<string, unknown>, conn: { select<T>(sql: string, params?: unknown): Promise<T[]>, dialect: string } } | string
> {
  const db = await databaseModule(ctx.cwd)
  if (!db)
    return 'The @elyvel/database package is not installed in this app.'
  try {
    const conn = ctx.app.make(db.DatabaseToken as never) as {
      select<T>(sql: string, params?: unknown): Promise<T[]>
      dialect: string
    }
    return { db, conn }
  }
  catch {
    return 'No database connection is bound — is EloquentServiceProvider registered in config/app.ts?'
  }
}

const databaseConnections: McpTool = {
  name: 'database-connections',
  description: 'List the database connections defined in config/database.ts and which one is the default.',
  inputSchema: z.object({}),
  readOnly: true,
  async handle(_args, ctx) {
    const cfg = ctx.app.config
    const connections = cfg.get<Record<string, { driver?: string }>>('database.connections', {}) ?? {}
    const names = Object.keys(connections)
    if (names.length === 0)
      return 'No database connections configured (config/database.ts).'
    const def = cfg.get<string>('database.default')
    return names
      .map(name => `${name} (${connections[name]?.driver ?? 'unknown driver'})${name === def ? ' [default]' : ''}`)
      .join('\n')
  },
}

const databaseSchema: McpTool = {
  name: 'database-schema',
  description:
    'Read the real database schema (tables and their columns) from the live connection. Use this before writing migrations, models, or queries — do not guess column names.',
  inputSchema: z.object({
    table: z.string().optional().describe('Only this table. Omit to list every table with its columns.'),
  }),
  readOnly: true,
  async handle(args, ctx) {
    const resolved = await databaseConnection(ctx)
    if (typeof resolved === 'string')
      return resolved
    const { db, conn } = resolved
    const listTables = db.listTables as (conn: unknown) => Promise<string[]>
    const tableColumns = db.tableColumns as (
      conn: unknown,
      table: string,
    ) => Promise<Array<{ name: string, type: string, nullable: boolean, default: string | null }>>

    const tables = await listTables(conn)
    if (tables.length === 0)
      return 'The database has no tables yet (run `elyvel migrate`?).'

    const wanted = typeof args.table === 'string' && args.table !== '' ? [args.table] : tables
    const unknown = wanted.filter(t => !tables.includes(t))
    if (unknown.length > 0)
      return `No such table: ${unknown.join(', ')}. Tables: ${tables.join(', ')}`

    const parts: string[] = []
    for (const table of wanted) {
      const columns = await tableColumns(conn, table)
      parts.push(`${table}:`)
      for (const col of columns) {
        const bits = [col.type, col.nullable ? 'nullable' : 'not null']
        if (col.default !== null)
          bits.push(`default ${col.default}`)
        parts.push(`  ${col.name}  ${bits.join(', ')}`)
      }
      parts.push('')
    }
    return parts.join('\n').trimEnd()
  },
}

/** Statements the query tool will run — reads only. */
const READ_ONLY_SQL = /^\s*(?:select|with|explain|show|describe|pragma)\b/i

/**
 * A single read-only statement, or the reason it isn't one. Exported for
 * tests — this guard is the entire safety story of `database-query`.
 */
export function assertReadOnlyQuery(query: string): string | null {
  const trimmed = query.trim().replace(/;\s*$/, '')
  if (trimmed === '')
    return 'Empty query.'
  if (trimmed.includes(';'))
    return 'Multiple statements are not allowed — send one read-only statement.'
  if (!READ_ONLY_SQL.test(trimmed))
    return 'Only read-only statements (SELECT / WITH / EXPLAIN / SHOW / DESCRIBE / PRAGMA) are allowed. Use the tinker tool with explicit user approval for writes.'
  return null
}

const MAX_QUERY_ROWS = 200

const databaseQuery: McpTool = {
  name: 'database-query',
  description:
    `Run one read-only SQL statement (SELECT / WITH / EXPLAIN / SHOW / DESCRIBE / PRAGMA) against the app's database and get the rows back as JSON. Writes are rejected.`,
  inputSchema: z.object({
    query: z.string().describe('One read-only SQL statement.'),
  }),
  readOnly: true,
  async handle(args, ctx) {
    const query = String(args.query ?? '')
    const rejection = assertReadOnlyQuery(query)
    if (rejection)
      return rejection

    const resolved = await databaseConnection(ctx)
    if (typeof resolved === 'string')
      return resolved

    try {
      const rows = await resolved.conn.select<Record<string, unknown>>(query.trim().replace(/;\s*$/, ''))
      const shown = rows.slice(0, MAX_QUERY_ROWS)
      const suffix = rows.length > shown.length ? `\n(${rows.length} rows total, showing first ${shown.length})` : ''
      return `${JSON.stringify(shown, null, 2)}${suffix}`
    }
    catch (error) {
      return `Query failed: ${error instanceof Error ? error.message : String(error)}`
    }
  },
}

/* -------------------------------------------------------------------------- */
/* list-routes                                                                */
/* -------------------------------------------------------------------------- */

const listRoutes: McpTool = {
  name: 'list-routes',
  description: 'List every registered HTTP route (method, path, and — where recorded — middleware and authorize policy).',
  inputSchema: z.object({}),
  readOnly: true,
  async handle(_args, ctx) {
    const routes = ((ctx.app.elysia as unknown as { routes?: Array<{ method: string, path: string }> }).routes ?? [])
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
    if (routes.length === 0)
      return 'No routes registered.'

    const meta = new Map(routeMetaEntries().map(m => [`${m.method} ${m.path}`, m]))
    return routes
      .map((r) => {
        const m = meta.get(`${r.method} ${r.path}`)
        const extras = m
          ? ` ${[m.middleware.length > 0 ? `[${m.middleware.join(', ')}]` : '', m.authorize ? `authorize: ${m.authorize}` : ''].filter(Boolean).join(' ')}`
          : ''
        return `${r.method.padEnd(7)} ${r.path}${extras.trimEnd()}`
      })
      .join('\n')
  },
}

/* -------------------------------------------------------------------------- */
/* logs                                                                       */
/* -------------------------------------------------------------------------- */

/** The directory the file log channel writes to, from config — not a guess. */
export function logDirectory(ctx: McpContext): string {
  const channels = ctx.app.config.get<Record<string, { path?: string }>>('logging.channels', {}) ?? {}
  for (const channel of Object.values(channels)) {
    if (typeof channel?.path === 'string')
      return resolve(ctx.cwd, dirname(channel.path))
  }
  return resolve(ctx.cwd, 'storage/logs')
}

function formatEntry(entry: Record<string, unknown>): string {
  if (typeof entry._raw === 'string')
    return entry._raw
  const { time, level, message, ...rest } = entry
  delete rest.name
  const context = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : ''
  return `[${String(time ?? '?')}] ${String(level ?? '?')}: ${String(message ?? '')}${context}`
}

const readLogEntries: McpTool = {
  name: 'read-log-entries',
  description: 'Read the newest entries from the application log (storage/logs). Newest first. Filter by level or a search string.',
  inputSchema: z.object({
    entries: z.number().int().min(1).max(200).optional().describe('How many entries (default 20).'),
    level: z.string().optional().describe('Only this level, e.g. "error".'),
    search: z.string().optional().describe('Case-insensitive substring filter.'),
  }),
  readOnly: true,
  async handle(args, ctx) {
    const dir = logDirectory(ctx)
    const files = listLogFiles(dir)
    if (files.length === 0)
      return `No log files in ${dir}.`
    const newest = files[0]!
    const page = readEntries(join(dir, newest.name), {
      perPage: typeof args.entries === 'number' ? args.entries : 20,
      level: typeof args.level === 'string' ? args.level : undefined,
      q: typeof args.search === 'string' ? args.search : undefined,
      direction: 'desc',
    })
    if (page.entries.length === 0)
      return `No matching entries in ${newest.name} (${page.total} total).`
    return [`${newest.name} — showing ${page.entries.length} of ${page.total} matching entries, newest first:`, '', ...page.entries.map(formatEntry)].join('\n')
  },
}

const lastError: McpTool = {
  name: 'last-error',
  description: 'The most recent error-level entry in the application log, with its full context (stack trace, request id). Check this first when the user reports something broke.',
  inputSchema: z.object({}),
  readOnly: true,
  async handle(_args, ctx) {
    const dir = logDirectory(ctx)
    for (const file of listLogFiles(dir)) {
      for (const level of ['fatal', 'error']) {
        const page = readEntries(join(dir, file.name), { level, perPage: 1, direction: 'desc' })
        const entry = page.entries[0]
        if (entry)
          return `${file.name}:\n${JSON.stringify(entry, null, 2)}`
      }
    }
    return `No error entries found in ${dir}.`
  },
}

/* -------------------------------------------------------------------------- */
/* tinker                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One REPL context per server session, seeded lazily — variables persist
 * between tinker calls exactly like lines in an `elyvel tinker` session.
 */
const replContexts = new WeakMap<Application, Record<string, unknown>>()

async function replContextFor(ctx: McpContext): Promise<Record<string, unknown>> {
  const existing = replContexts.get(ctx.app)
  if (existing)
    return existing

  // The same seed `elyvel tinker` builds — models, helpers, `app`, `config()`.
  const core = (await import(Bun.resolveSync('@elyvel/core', ctx.cwd))) as Record<string, unknown>
  const { seed } = await buildTinkerSeed(ctx.cwd, ctx.app, core)
  const context = createReplContext(seed)
  replContexts.set(ctx.app, context)
  return context
}

const tinker: McpTool = {
  name: 'tinker',
  description:
    'Run TypeScript in the booted application context (like `elyvel tinker`): models from app/models, `app`, and `config()` are in scope, `await` works, variables persist between calls. Use for debugging and inspection; do not create or mutate records without explicit user approval — prefer tests with factories.',
  inputSchema: z.object({
    code: z.string().describe('The code to evaluate. The value of the last expression is returned.'),
  }),
  readOnly: false,
  async handle(args, ctx) {
    const context = await replContextFor(ctx)
    const printed: string[] = []
    const original = { log: console.log, info: console.info, warn: console.warn }
    const capture = (...parts: unknown[]): void => {
      printed.push(parts.map(p => (typeof p === 'string' ? p : Bun.inspect(p, { depth: 4 }))).join(' '))
    }
    console.log = capture
    console.info = capture
    console.warn = capture
    try {
      const value = await evaluateLine(String(args.code ?? ''), context)
      const result = value === undefined ? 'undefined' : Bun.inspect(value, { depth: 4 })
      return printed.length > 0 ? `${printed.join('\n')}\n=> ${result}` : `=> ${result}`
    }
    catch (error) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      return printed.length > 0 ? `${printed.join('\n')}\n${detail}` : detail
    }
    finally {
      console.log = original.log
      console.info = original.info
      console.warn = original.warn
    }
  },
}

/* -------------------------------------------------------------------------- */
/* get-absolute-url                                                           */
/* -------------------------------------------------------------------------- */

const getAbsoluteUrl: McpTool = {
  name: 'get-absolute-url',
  description: 'Resolve a path to the application\'s absolute URL (correct scheme, host, and port). Use this before sharing any project URL with the user.',
  inputSchema: z.object({
    path: z.string().optional().describe('Path to resolve, e.g. "/login". Defaults to the app root.'),
  }),
  readOnly: true,
  async handle(args, ctx) {
    const cfg = ctx.app.config
    const configured = cfg.get<string>('app.url')
    const base = configured && configured !== ''
      ? configured
      : `http://localhost:${Number(cfg.get('app.port', 3000))}`
    return new URL(typeof args.path === 'string' ? args.path : '/', base).toString()
  },
}

/** Every tool the elyvel MCP server exposes. */
export const mcpTools: McpTool[] = [
  applicationInfo,
  databaseConnections,
  databaseSchema,
  databaseQuery,
  listRoutes,
  readLogEntries,
  lastError,
  tinker,
  getAbsoluteUrl,
]
