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

/**
 * Where maintenance-mode state lives. Back it with a shared store (Redis) via
 * {@link configureMaintenanceStore} for multi-instance deploys — without one,
 * `elyvel down` only takes down the ONE instance whose local disk got the
 * file written, so a load balancer keeps routing to the others and the app
 * silently stays "up" for most users during the outage window.
 */
export interface MaintenanceStore {
  write(payload: DownPayload): Promise<void>
  read(): Promise<DownPayload | null>
  clear(): Promise<void>
}

/** The original file-based store (one process/instance's local disk only). */
export class FileMaintenanceStore implements MaintenanceStore {
  constructor(private readonly file: string) {}

  async write(payload: DownPayload): Promise<void> {
    bringDown(this.file, payload)
  }

  async read(): Promise<DownPayload | null> {
    return readDownPayload(this.file)
  }

  async clear(): Promise<void> {
    bringUp(this.file)
  }
}

/** Minimal Redis client (Bun's built-in `RedisClient` satisfies this via `send`). */
export interface RedisLike {
  send(command: string, args: string[]): Promise<unknown>
}

/**
 * Redis-backed maintenance store — every instance sharing this Redis sees
 * the same down/up state, so `elyvel down` actually takes down the whole
 * app, not just the instance the CLI happened to run on.
 */
export class RedisMaintenanceStore implements MaintenanceStore {
  constructor(
    private readonly client: RedisLike,
    private readonly key = 'elyvel:maintenance',
  ) {}

  async write(payload: DownPayload): Promise<void> {
    await this.client.send('SET', [this.key, JSON.stringify(payload)])
  }

  async read(): Promise<DownPayload | null> {
    const raw = (await this.client.send('GET', [this.key])) as string | null
    if (!raw)
      return null
    try {
      return JSON.parse(raw) as DownPayload
    }
    catch {
      return {}
    }
  }

  async clear(): Promise<void> {
    await this.client.send('DEL', [this.key])
  }
}

let store: MaintenanceStore | null = null
/** Wire the store backing maintenance mode (e.g. `RedisMaintenanceStore`). */
export function configureMaintenanceStore(next: MaintenanceStore): void {
  store = next
}
/** The configured store, or `null` if none was set (falls back to the local file). */
export function maintenanceStore(): MaintenanceStore | null {
  return store
}
/** Test-only: clears the configured store back to `null` (the file fallback). */
export function resetMaintenanceStore(): void {
  store = null
}

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
 * Global maintenance-mode guard. When the down state is present every request
 * gets a 503 (JSON or HTML per content negotiation) with `Retry-After`,
 * unless it carries the bypass secret. Visiting `/?secret=…` sets a cookie so
 * that browser is let through for the rest of the outage. Mounted before
 * routes so it covers everything.
 *
 * Checks {@link maintenanceStore} fresh on every request (not just once at
 * mount time) — so a `configureMaintenanceStore(...)` call made later during
 * boot (a ServiceProvider's `register()`/`boot()`, which runs after this
 * plugin is mounted) still takes effect. Falls back to `file` when no store
 * has been configured — the original, single-instance-only behavior.
 */
export function maintenanceMode(file: string) {
  const fallback = new FileMaintenanceStore(file)
  return new Elysia({ name: 'elyvel-maintenance' }).onRequest(async ({ request }) => {
    const payload = await (maintenanceStore() ?? fallback).read()
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
