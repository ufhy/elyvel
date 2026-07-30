import { isAbsolute, resolve } from 'node:path'
import { Elysia } from 'elysia'
import { renderLogViewerPage } from './page'
import { deleteLogFile, listLogFiles, readEntries, resolveLogFile } from './reader'

export type { EntryPage, EntryQuery, LogEntry, LogFileInfo } from './reader'

/** Anything with the bits the log viewer's guard/handlers need — Elysia's context satisfies this. */
interface Ctx {
  request: Request
  query: Record<string, string | undefined>
  params: Record<string, string | undefined>
  set: { headers: Record<string, string | number> }
  status(code: number, body?: unknown): unknown
  [key: string]: unknown
}

export interface LogViewerConfig {
  /**
   * Who may access the log viewer. Required — with no `authorize` configured,
   * every request is denied (403). There's no environment-based default here
   * (unlike the debug error page): this is meant to run wherever *you* decide
   * to turn it on, production included — you own the gate.
   */
  authorize?(ctx: Ctx): boolean | Promise<boolean>
}

let config: LogViewerConfig = {}

/** Configure who can access the log viewer — usually in a service provider's `boot()`. */
export function configureLogViewer(cfg: LogViewerConfig): void {
  config = cfg
}

/** Test-only: reset the configured authorize function. */
export function resetLogViewerConfig(): void {
  config = {}
}

export interface LogViewerOptions {
  /** Where to mount the UI + its API. Default `/log-viewer`. */
  path?: string
  /** Directory holding the log files. Relative paths resolve against `process.cwd()`. Default `storage/logs`. */
  logDir?: string
}

/**
 * A web UI for browsing `storage/logs/*.log` — filter by level, search, page
 * through entries, expand one for its full stack trace, download or delete a
 * file. Install it and gate it yourself:
 *
 *   configureLogViewer({ authorize: ctx => Boolean(ctx.user?.isAdmin) })
 *   app.use(logViewer())
 *
 * Reads the framework's own JSON-lines log format directly — no per-format
 * parser needed. Understands the active file, size-rotated (`app.log.1`),
 * and daily-rotated (`app-2026-07-19.log`) files; not gzipped rotations.
 */
export function logViewer(options: LogViewerOptions = {}): Elysia {
  const path = options.path ?? '/log-viewer'
  const rawDir = options.logDir ?? 'storage/logs'
  const logDir = isAbsolute(rawDir) ? rawDir : resolve(process.cwd(), rawDir)

  /**
   * The 403 response when access is denied, or `undefined` when allowed.
   *
   * Callers compare against `undefined` rather than testing truthiness: every
   * route here gates on this one value, and a falsy-but-present response would
   * have granted access on the four routes that used `if (denied)` while the one
   * using `??` still denied — the same guard behaving differently on sibling
   * paths is how an authorization hole hides.
   */
  async function denyUnlessAuthorized(ctx: Ctx): Promise<unknown> {
    const allowed = config.authorize ? await config.authorize(ctx) : false
    if (!allowed)
      return ctx.status(403, { message: 'Forbidden' })
    return undefined
  }

  /** Resolves `name` to a real path, only if it's both safe and an actual log file in `logDir`. */
  function knownFile(name: string): string | undefined {
    const resolved = resolveLogFile(logDir, name)
    if (!resolved)
      return undefined
    return listLogFiles(logDir).some(f => f.name === name) ? resolved : undefined
  }

  return new Elysia({ name: 'elyvel-log-viewer' })
    .get(path, async (ctx: any) => {
      const denied = await denyUnlessAuthorized(ctx)
      if (denied !== undefined)
        return denied
      ctx.set.headers['content-type'] = 'text/html; charset=utf-8'
      return renderLogViewerPage(path)
    })
    .get(`${path}/api/files`, async (ctx: any) => {
      const denied = await denyUnlessAuthorized(ctx)
      return denied ?? { files: listLogFiles(logDir) }
    })
    .get(`${path}/api/files/:name/entries`, async (ctx: any) => {
      const denied = await denyUnlessAuthorized(ctx)
      if (denied !== undefined)
        return denied
      const file = knownFile(ctx.params.name)
      if (!file)
        return ctx.status(404, { message: 'Log file not found' })
      return readEntries(file, {
        level: ctx.query.level || undefined,
        q: ctx.query.q || undefined,
        page: ctx.query.page ? Number(ctx.query.page) : undefined,
        perPage: ctx.query.perPage ? Number(ctx.query.perPage) : undefined,
        direction: ctx.query.direction === 'asc' ? 'asc' : 'desc',
      })
    })
    .get(`${path}/api/files/:name/download`, async (ctx: any) => {
      const denied = await denyUnlessAuthorized(ctx)
      if (denied !== undefined)
        return denied
      const file = knownFile(ctx.params.name)
      if (!file)
        return ctx.status(404, { message: 'Log file not found' })
      ctx.set.headers['content-type'] = 'text/plain; charset=utf-8'
      ctx.set.headers['content-disposition'] = `attachment; filename="${ctx.params.name}"`
      return Bun.file(file)
    })
    .delete(`${path}/api/files/:name`, async (ctx: any) => {
      const denied = await denyUnlessAuthorized(ctx)
      if (denied !== undefined)
        return denied
      const file = knownFile(ctx.params.name)
      if (!file)
        return ctx.status(404, { message: 'Log file not found' })
      deleteLogFile(file)
      return { deleted: true }
    }) as unknown as Elysia
}
