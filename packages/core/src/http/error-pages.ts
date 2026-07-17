import type { RenderableView } from './error-page'
import { Elysia } from 'elysia'
import { defaultErrorMessage, errorPageResolver, renderErrorPage } from './error-page'
import { expectsJson } from './negotiation'

/** The parts of a session the error views read (from `@elysia-ravel/session`). */
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
  if (typeof (error as { status?: unknown } | null)?.status === 'number')
    return (error as { status: number }).status
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
 * 5xx stays generic (never leak internals); Elysia's ALL_CAPS error codes
 * (`NOT_FOUND`, `VALIDATION`, …) are treated as non-messages.
 */
function safeMessage(status: number, raw: unknown): string | undefined {
  if (status >= 500)
    return undefined
  if (typeof raw !== 'string' || !raw || /^[A-Z][A-Z0-9_]*$/.test(raw))
    return undefined
  return raw
}

function jsonBody(status: number, message: string | undefined, errors: unknown): string {
  const payload: Record<string, unknown> = { message: message ?? defaultErrorMessage(status), status }
  if (errors !== undefined)
    payload.errors = errors
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
 * (custom HTML string / `Response` / a `view(...)` result), then fall back to
 * the framework's default page.
 */
async function webResponse(status: number, message: string | undefined, error: unknown, ctx: any): Promise<string | Response> {
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
      if (typeof custom === 'object' && (custom as RenderableView).__ravelView === true) {
        const view = custom as RenderableView
        ctx.set.status = view.statusCode ?? status
        ctx.set.headers['content-type'] = 'text/html; charset=utf-8'
        return view.render(viewShared(ctx.session))
      }
    }
  }
  ctx.set.status = status
  ctx.set.headers['content-type'] = 'text/html; charset=utf-8'
  return renderErrorPage(status, { message })
}

export function errorPages() {
  return (
    new Elysia({ name: 'ravel-error-pages' })
      // Thrown errors + unmatched routes (request-context has logged; the session
      // plugin has already redirected web 422 validation errors before us).
      .onError({ as: 'global' }, async (ctx: any) => {
        const status = resolveStatus(ctx.code, ctx.error)
        const message = safeMessage(status, ctx.error?.message)
        if (expectsJson(ctx.request)) {
          ctx.set.status = status
          ctx.set.headers['content-type'] = 'application/json'
          return jsonBody(status, message, (ctx.error as { errors?: unknown })?.errors)
        }
        return webResponse(status, message, ctx.error, ctx)
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
        return webResponse(status, safeMessage(status, message), undefined, ctx)
      })
  )
}
