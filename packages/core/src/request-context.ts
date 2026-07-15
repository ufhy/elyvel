import { Elysia } from 'elysia'
import { expectsJson } from './http/negotiation'
import { type Logger, createLogger } from './logger'

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

  return new Elysia({ name: 'ravel-request-context' })
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
    .onAfterResponse({ as: 'global' }, ({ request, set }) => {
      const info = meta.get(request)
      meta.delete(request)

      const ms =
        info !== undefined ? Math.round((performance.now() - info.start) * 100) / 100 : undefined
      const { pathname } = new URL(request.url)
      const status = typeof set.status === 'number' ? set.status : 200
      const context = { requestId: info?.id, status, ms }
      const line = `${request.method} ${pathname}`

      if (status >= 500) http.error(line, context)
      else if (status >= 400) http.warn(line, context)
      else http.info(line, context)
    })
    .onError({ as: 'global' }, ({ request, error, code, set }) => {
      const { pathname } = new URL(request.url)
      const requestId = meta.get(request)?.id
      const message = error instanceof Error ? error.message : String(error)

      // Client errors that carry a status (e.g. ValidationException 422,
      // AuthorizationException 403) are rendered as JSON — duck-typed so core
      // stays decoupled from the validation package.
      const status = (error as { status?: unknown }).status
      if (typeof status === 'number' && status >= 400 && status < 500) {
        const errors = (error as { errors?: unknown }).errors
        // A web (non-JSON) validation error is handled by the session plugin's
        // onError, which redirects back with the errors flashed — let it run.
        if (errors && status === 422 && !expectsJson(request)) return undefined
        set.status = status
        http.warn(`${request.method} ${pathname}`, { requestId, status })
        return errors ? { message, errors } : { message }
      }

      http.error(`${request.method} ${pathname} threw`, {
        requestId,
        code,
        error: message,
        stack: error instanceof Error ? error.stack : undefined,
      })
    })
}
