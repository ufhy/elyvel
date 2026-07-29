import type { DebugInfo, RenderableView } from './error-page'
import { isHttpException } from '@elyvel/support'
import { Elysia } from 'elysia'
import { debugInfo, defaultErrorMessage, errorPageResolver, renderDebugPage, renderErrorPage } from './error-page'
import { expectsJson } from './negotiation'

/** The parts of a session the error views read (from `@elyvel/session`). */
interface SessionLike {
  get?(key: string): unknown
  token?(): string
}

/** How Elysia wraps a returned `status(code, body)` — `{ code, response }`. */
interface StatusResponse {
  code: number
  response: unknown
}

/**
 * Framework default error handling (à la Laravel's exception handler): turn HTTP
 * errors into a styled HTML page for browser navigations, and JSON for API/XHR
 * clients. Covers both thrown errors (404 not-found, validation, uncaught 500s)
 * and error-status responses returned by guards (403 `can`, 429 throttle).
 *
 * Apps customize the HTML via `configureErrorPage(...)` — that resolver is only
 * consulted on the web lane, so JSON/API responses are never affected.
 */
function resolveStatus(code: string, error: unknown): number {
  // Only an exception AUTHORED to face the client picks its own status. This used
  // to trust any object with a numeric `status`, and outbound HTTP clients and
  // database drivers routinely carry one — so a driver rejection was relayed as a
  // plausible-looking 4xx instead of the 500 it actually was. Everything
  // unmarked falls through to the code switch below (500 by default).
  if (isHttpException(error))
    return error.status
  switch (code) {
    case 'NOT_FOUND':
      return 404
    case 'VALIDATION':
      return 422
    case 'PARSE':
    case 'INVALID_COOKIE_SIGNATURE':
      return 400
    default:
      return 500
  }
}

/**
 * A safe, human message for the client, or undefined to use the status default.
 *
 * Only an {@link HttpException}'s message is shown. Previously ANY error's
 * message was echoed verbatim below 500, in production too — so an internal
 * fault that happened to carry `status: 404` leaked its text to the client:
 * hostnames, connection strings, even credentials sitting in a query string.
 * 5xx was already scrubbed; now everything unmarked is.
 *
 * Elysia's ALL_CAPS error codes (`NOT_FOUND`, `VALIDATION`, …) are still treated
 * as non-messages so the status default is used instead.
 */
function safeMessage(status: number, error: unknown): string | undefined {
  if (status >= 500 || !isHttpException(error))
    return undefined
  return presentableMessage(error.message)
}

/**
 * The message of an error-status response a handler or guard RETURNED, e.g.
 * `status(403, { message: '…' })` from the `can` guard or the throttler.
 *
 * Separate from {@link safeMessage} on purpose: the app chose this status and
 * body explicitly, so the message is client-facing by construction — there is no
 * exception object to check a marker on. Keeping one shared helper here would
 * have silently swallowed every custom guard message.
 */
function safeResponseMessage(status: number, raw: string | undefined): string | undefined {
  if (status >= 500)
    return undefined
  return presentableMessage(raw)
}

/** Drops empty strings and Elysia's ALL_CAPS codes (`NOT_FOUND`, `VALIDATION`, …). */
function presentableMessage(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw || /^[A-Z][A-Z0-9_]*$/.test(raw))
    return undefined
  return raw
}

function jsonBody(status: number, message: string | undefined, errors: unknown, debug?: DebugInfo): string {
  const payload: Record<string, unknown> = { message: message ?? defaultErrorMessage(status), status }
  if (errors !== undefined)
    payload.errors = errors
  if (debug) {
    payload.exception = debug.exception
    payload.file = debug.file
    payload.line = debug.line
    payload.stack = debug.stack
  }
  return JSON.stringify(payload)
}

/** Shared view data (errors/old/flash/csrf) for a custom error view. */
function viewShared(session: SessionLike | undefined): Record<string, unknown> {
  const oldInput = (session?.get?.('_old_input') ?? {}) as Record<string, unknown>
  return {
    errors: session?.get?.('errors') ?? {},
    old: (key: string, fallback?: unknown) => oldInput[key] ?? fallback,
    flash: (key: string, fallback?: unknown) => session?.get?.(key) ?? fallback,
    csrf: session?.token?.() ?? '',
    globals: {},
  }
}

/**
 * Render the web (HTML) response: consult the app's custom resolver first
 * (custom HTML string / `Response` / a `view(...)` result); if it declines
 * and this is an uncaught 500 with `debug` on, show the stack-trace debug
 * page; otherwise fall back to the framework's generic default page.
 */
async function webResponse(
  status: number,
  message: string | undefined,
  error: unknown,
  ctx: any,
  debug: boolean,
): Promise<string | Response> {
  const resolver = errorPageResolver()
  if (resolver) {
    const custom = await resolver(status, { request: ctx.request, message, error, session: ctx.session })
    if (custom != null) {
      if (custom instanceof Response)
        return custom
      if (typeof custom === 'string') {
        ctx.set.status = status
        ctx.set.headers['content-type'] = 'text/html; charset=utf-8'
        return custom
      }
      if (typeof custom === 'object' && (custom as RenderableView).__elyvelView === true) {
        const view = custom as RenderableView
        ctx.set.status = view.statusCode ?? status
        ctx.set.headers['content-type'] = 'text/html; charset=utf-8'
        return view.render(viewShared(ctx.session))
      }
    }
  }
  ctx.set.status = status
  ctx.set.headers['content-type'] = 'text/html; charset=utf-8'
  if (debug && status >= 500 && error instanceof Error) {
    return renderDebugPage({ method: ctx.request.method, url: ctx.request.url, error })
  }
  return renderErrorPage(status, { message })
}

export interface ErrorPagesOptions {
  /** Show the stack-trace debug page for uncaught 500s. Never in production. */
  debug?: boolean
}

export function errorPages(options: ErrorPagesOptions = {}) {
  const debug = options.debug ?? false
  return (
    new Elysia({ name: 'elyvel-error-pages' })
      // Thrown errors + unmatched routes (request-context has logged; the session
      // plugin has already redirected web 422 validation errors before us).
      .onError({ as: 'global' }, async (ctx: any) => {
        const status = resolveStatus(ctx.code, ctx.error)
        const message = safeMessage(status, ctx.error)
        if (expectsJson(ctx.request)) {
          ctx.set.status = status
          ctx.set.headers['content-type'] = 'application/json'
          const debugPayload = debug && status >= 500 && ctx.error instanceof Error ? debugInfo(ctx.error) : undefined
          // Field errors, too, come only from a client-facing exception — a
          // foreign error carrying an `errors` property used to have it echoed.
          const errors = isHttpException(ctx.error) ? ctx.error.errors : undefined
          return jsonBody(status, message, errors, debugPayload)
        }
        return webResponse(status, message, ctx.error, ctx, debug)
      })
      // Error-status responses RETURNED by handlers/guards. Elysia wraps
      // `status(code, body)` as `{ code, response }`; unwrap and, for browser
      // navigations, rewrite it into a page (API/JSON is left as-is).
      .onAfterHandle({ as: 'global' }, async (ctx: any) => {
        const res = ctx.response
        if (!res || typeof res !== 'object' || typeof (res as StatusResponse).code !== 'number')
          return
        const status = (res as StatusResponse).code
        if (status < 400 || expectsJson(ctx.request))
          return
        const body = (res as StatusResponse).response
        const message
          = body && typeof body === 'object' && 'message' in body ? String(body.message) : undefined
        return webResponse(status, safeResponseMessage(status, message), undefined, ctx, debug)
      })
  )
}
