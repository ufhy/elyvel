import { Elysia } from 'elysia'
import { defaultErrorMessage, renderErrorPage } from './error-page'
import { expectsJson } from './negotiation'

/**
 * Framework default error handling (à la Laravel's exception handler): turn HTTP
 * errors into a styled HTML page for browser navigations, and JSON for API/XHR
 * clients. Covers both thrown errors (404 not-found, validation, uncaught 500s)
 * and error-status responses returned by guards (403 `can`, 429 throttle).
 */
function resolveStatus(code: string, error: any): number {
  if (typeof error?.status === 'number')
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

function pageOr(json: boolean, status: number, message: string | undefined, set: any, errors?: unknown): string {
  set.status = status
  if (json) {
    set.headers['content-type'] = 'application/json'
    const payload: Record<string, unknown> = { message: message ?? defaultErrorMessage(status), status }
    if (errors !== undefined)
      payload.errors = errors
    return JSON.stringify(payload)
  }
  set.headers['content-type'] = 'text/html; charset=utf-8'
  return renderErrorPage(status, { message })
}

export function errorPages() {
  return (
    new Elysia({ name: 'ravel-error-pages' })
      // Thrown errors + unmatched routes (request-context has logged; the session
      // plugin has already redirected web 422 validation errors before us).
      .onError({ as: 'global' }, (ctx: any) => {
        const status = resolveStatus(ctx.code, ctx.error)
        const errors = (ctx.error as { errors?: unknown })?.errors
        return pageOr(expectsJson(ctx.request), status, safeMessage(status, ctx.error?.message), ctx.set, errors)
      })
      // Error-status responses RETURNED by handlers/guards. Elysia wraps
      // `status(code, body)` as `{ code, response }`; unwrap and, for browser
      // navigations, rewrite it into an HTML page (API/JSON is left as-is).
      .onAfterHandle({ as: 'global' }, (ctx: any) => {
        const res = ctx.response
        if (!res || typeof res !== 'object' || typeof (res as any).code !== 'number')
          return
        const status = (res as any).code
        if (status < 400 || expectsJson(ctx.request))
          return
        const body = (res as any).response
        const message
          = body && typeof body === 'object' && 'message' in body ? String(body.message) : undefined
        return pageOr(false, status, safeMessage(status, message), ctx.set)
      })
  )
}
