import type { Logger } from './logger'
import { Elysia } from 'elysia'
import { shouldReportError } from './exception-handling'
import { createLogger } from './logger'

/** Reads `ctx.user.id` if present — duck-typed so core stays decoupled from @elyvel/auth. */
function userId(ctx: { user?: { id?: unknown } | null }): unknown {
  return ctx.user?.id
}

interface RequestMeta {
  start: number
  id: string
}

/**
 * Process-wide default logger for the request context, set by the Application
 * at boot so route files can `.use(requestContext())` with no arguments and
 * still get the real, configured logger — the same pattern the ORM uses for
 * its default connection.
 */
let currentLogger: Logger | null = null

export function setRequestLogger(logger: Logger): void {
  currentLogger = logger
}

/**
 * A single named plugin that provides request logging *and* the typed
 * request-scoped context:
 *
 *  - assigns each request a correlation id (`requestId`);
 *  - exposes a per-request `log` (the app logger bound to that id);
 *  - logs each request (method, path, status, ms) and unhandled errors
 *    (code + stack), all carrying the same `requestId`.
 *
 * Because it has a stable `name`, Elysia de-duplicates it: the Application
 * mounts it once at the root (real logging happens there), while route files
 * may `.use(requestContext())` purely to gain the typed `log`/`requestId` in
 * their handler context.
 */
export function requestContext(logger: Logger = currentLogger ?? createLogger()) {
  const meta = new WeakMap<Request, RequestMeta>()
  const http = logger.child('http')

  return new Elysia({ name: 'elyvel-request-context' })
    .onRequest(({ request }) => {
      meta.set(request, { start: performance.now(), id: crypto.randomUUID() })
    })
    .derive({ as: 'global' }, ({ request }) => {
      const id = meta.get(request)?.id
      return {
        requestId: id,
        log: id ? logger.withBindings({ requestId: id }) : logger,
      }
    })
    .onAfterResponse({ as: 'global' }, (ctx: any) => {
      const { request, set } = ctx
      const info = meta.get(request)
      meta.delete(request)

      const ms
        = info !== undefined ? Math.round((performance.now() - info.start) * 100) / 100 : undefined
      const { pathname } = new URL(request.url)
      const status = typeof set.status === 'number' ? set.status : 200
      const uid = userId(ctx)
      const context = { requestId: info?.id, status, ms, ...(uid !== undefined ? { userId: uid } : {}) }
      const line = `${request.method} ${pathname}`

      // A successful request is framework-level noise, not something the app
      // developer wrote — it only shows up if they opt into `debug` level.
      // `info` and up stays reserved for what the app itself chooses to log.
      if (status >= 500)
        http.error(line, context)
      else if (status >= 400)
        http.warn(line, context)
      else http.debug(line, context)
    })
    // Log only — rendering (HTML page / JSON) is owned by the errorPages plugin,
    // and 422 validation redirect-back by the session plugin. Returning undefined
    // lets those downstream handlers run.
    .onError({ as: 'global' }, (ctx: any) => {
      const { request, error, code } = ctx
      const { pathname } = new URL(request.url)
      const requestId = meta.get(request)?.id
      const message = error instanceof Error ? error.message : String(error)
      const status
        = typeof (error as { status?: unknown }).status === 'number'
          ? (error as { status: number }).status
          : code === 'NOT_FOUND' ? 404 : code === 'VALIDATION' ? 422 : 500

      if (status >= 500) {
        // dontReport/dontReportWhen/throttle/dontReportDuplicates can silence
        // this — the client still gets the normal error response either way,
        // this only controls whether it's worth a log entry.
        if (shouldReportError(error)) {
          const uid = userId(ctx)
          http.error(`${request.method} ${pathname} threw`, {
            requestId,
            code,
            error: message,
            stack: error instanceof Error ? error.stack : undefined,
            ...(uid !== undefined ? { userId: uid } : {}),
          })
        }
      }
      else {
        http.warn(`${request.method} ${pathname}`, { requestId, status })
      }
      return undefined
    })
}
