import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { trans } from '@elyvel/support'
import { Elysia } from 'elysia'
import { expectsJson } from './http/negotiation'

/** Payload persisted in the `down` file — mirrors `php artisan down` options. */
export interface DownPayload {
  /** `Retry-After` header value, in seconds. */
  retryAfter?: number
  /** Bypass secret: `GET /?secret=…` sets a cookie that lets that browser through. */
  secret?: string
  /** Message shown on the 503 page. */
  message?: string
  /** Status code to serve (default 503). */
  status?: number
}

const BYPASS_COOKIE = 'elyvel_maintenance'

/** Put the app into maintenance mode by writing the `down` file. */
export function bringDown(file: string, payload: DownPayload = {}): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(payload), 'utf8')
}

/** Bring the app back up by removing the `down` file. */
export function bringUp(file: string): void {
  if (existsSync(file))
    rmSync(file)
}

/** Whether the `down` file is present. */
export function isDownForMaintenance(file: string): boolean {
  return existsSync(file)
}

/** Read the `down` payload, or `null` when the app is up. */
export function readDownPayload(file: string): DownPayload | null {
  if (!existsSync(file))
    return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as DownPayload
  }
  catch {
    return {}
  }
}

function cookieHas(header: string | null, name: string, value: string): boolean {
  if (!header)
    return false
  return header.split(';').some((part) => {
    const [k, v] = part.trim().split('=')
    return k === name && v === value
  })
}

/**
 * Global maintenance-mode guard. When the `down` file exists every request gets a
 * 503 (JSON or HTML per content negotiation) with `Retry-After`, unless it carries
 * the bypass secret. Visiting `/?secret=…` sets a cookie so that browser is let
 * through for the rest of the outage. Mounted before routes so it covers everything.
 */
export function maintenanceMode(file: string) {
  return new Elysia({ name: 'elyvel-maintenance' }).onRequest(({ request }) => {
    const payload = readDownPayload(file)
    if (!payload)
      return

    const url = new URL(request.url)

    // `?secret=…` → set the bypass cookie and redirect to the clean path.
    if (payload.secret && url.searchParams.get('secret') === payload.secret) {
      url.searchParams.delete('secret')
      return new Response(null, {
        status: 302,
        headers: {
          'location': url.pathname + url.search,
          'set-cookie': `${BYPASS_COOKIE}=${payload.secret}; Path=/; HttpOnly; SameSite=Lax`,
        },
      })
    }

    // Already holding the bypass cookie → let through.
    if (payload.secret && cookieHas(request.headers.get('cookie'), BYPASS_COOKIE, payload.secret))
      return

    const status = payload.status ?? 503
    const message = payload.message ?? trans('errors.503.message', {}, 'Service Unavailable')
    const headers: Record<string, string> = {}
    if (payload.retryAfter)
      headers['retry-after'] = String(payload.retryAfter)

    if (expectsJson(request)) {
      headers['content-type'] = 'application/json'
      return new Response(JSON.stringify({ message }), { status, headers })
    }
    headers['content-type'] = 'text/html'
    return new Response(maintenancePage(message), { status, headers })
  })
}

function maintenancePage(message: string): string {
  const safe = message.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!))
  return `<!doctype html><html><head><meta charset="utf-8"><title>${safe}</title>`
    + `<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#0f172a;color:#e2e8f0}`
    + `.box{text-align:center}h1{font-size:3rem;margin:0 0 .5rem}p{color:#94a3b8}</style></head>`
    + `<body><div class="box"><h1>503</h1><p>${safe}</p></div></body></html>`
}
