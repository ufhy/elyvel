import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Elysia } from 'elysia'
import { Middleware, type MiddlewareContext } from './middleware'

const TOKEN_KEY = '_token'
const FLASH_KEY = '_flash'

interface FlashState {
  old: string[]
  new: string[]
}

/**
 * A per-request session, à la Laravel. Read/write with `get`/`put`, keep values
 * for the next request only with `flash`, and read the CSRF token with `token`.
 */
export class Session {
  private data: Record<string, unknown>

  constructor(data: Record<string, unknown> = {}) {
    this.data = { ...data }
  }

  /** Ensure a CSRF token exists (called when the session starts). */
  ensureToken(): void {
    if (typeof this.data[TOKEN_KEY] !== 'string') this.data[TOKEN_KEY] = randomBytes(20).toString('hex')
  }
  token(): string {
    return this.data[TOKEN_KEY] as string
  }
  regenerateToken(): void {
    this.data[TOKEN_KEY] = randomBytes(20).toString('hex')
  }

  get<T = unknown>(key: string): T | undefined
  get<T = unknown>(key: string, fallback: T): T
  get(key: string, fallback?: unknown): unknown {
    return key in this.data ? this.data[key] : fallback
  }
  put(key: string, value: unknown): void {
    this.data[key] = value
  }
  /** Present AND not null. */
  has(key: string): boolean {
    return this.data[key] !== undefined && this.data[key] !== null
  }
  /** Present, even if null. */
  exists(key: string): boolean {
    return key in this.data
  }
  missing(key: string): boolean {
    return !this.exists(key)
  }
  forget(key: string): void {
    delete this.data[key]
  }
  /** Append a value onto an array session value. */
  push(key: string, value: unknown): void {
    const arr = Array.isArray(this.data[key]) ? (this.data[key] as unknown[]) : []
    arr.push(value)
    this.data[key] = arr
  }
  /** Retrieve and remove a value in one step. */
  pull<T = unknown>(key: string): T | undefined
  pull<T = unknown>(key: string, fallback: T): T
  pull(key: string, fallback?: unknown): unknown {
    const value = key in this.data ? this.data[key] : fallback
    this.forget(key)
    return value
  }
  increment(key: string, amount = 1): number {
    const value = Number(this.get(key, 0)) + amount
    this.put(key, value)
    return value
  }
  decrement(key: string, amount = 1): number {
    return this.increment(key, -amount)
  }
  /** Get the value, or store and return the result of `factory` if absent. */
  remember<T>(key: string, factory: () => T): T {
    if (this.exists(key)) return this.get<T>(key) as T
    const value = factory()
    this.put(key, value)
    return value
  }
  /** Rotate the CSRF token, keeping session data (anti session-fixation). */
  regenerate(): void {
    this.regenerateToken()
  }
  /** Clear all data and rotate the token. */
  invalidate(): void {
    this.flush()
    this.regenerateToken()
  }
  /** Clear everything except the CSRF token. */
  flush(): void {
    const token = this.data[TOKEN_KEY]
    this.data = { [TOKEN_KEY]: token }
  }
  all(): Record<string, unknown> {
    const { [FLASH_KEY]: _flash, ...rest } = this.data
    return rest
  }

  /** Store a value available only on the next request. */
  flash(key: string, value: unknown): void {
    this.put(key, value)
    const flash = this.flashState()
    if (!flash.new.includes(key)) flash.new.push(key)
    flash.old = flash.old.filter((k) => k !== key)
  }
  /** Keep all flashed data for one more request. */
  reflash(): void {
    const flash = this.flashState()
    flash.new = [...new Set([...flash.new, ...flash.old])]
    flash.old = []
  }
  /** Keep specific flashed keys for one more request. */
  keep(keys: string[]): void {
    const flash = this.flashState()
    flash.new = [...new Set([...flash.new, ...keys])]
    flash.old = flash.old.filter((k) => !keys.includes(k))
  }

  private flashState(): FlashState {
    if (!this.data[FLASH_KEY]) this.data[FLASH_KEY] = { old: [], new: [] }
    return this.data[FLASH_KEY] as FlashState
  }

  /** Expire last request's flash, promote this request's flash (called on save). */
  ageFlashData(): void {
    const flash = this.flashState()
    for (const key of flash.old) if (!flash.new.includes(key)) delete this.data[key]
    flash.old = flash.new
    flash.new = []
  }

  toData(): Record<string, unknown> {
    return this.data
  }
}

// ── cookie payload crypto (AES-256-GCM) ─────────────────────────────────────
function keyFrom(secret: string): Buffer {
  return createHash('sha256').update(secret).digest()
}
function encrypt(data: Record<string, unknown>, secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv)
  const enc = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`
}
function decrypt(payload: string, secret: string): Record<string, unknown> | null {
  try {
    const [iv, tag, enc] = payload.split('.')
    const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(iv as string, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag as string, 'base64url'))
    const out = Buffer.concat([decipher.update(Buffer.from(enc as string, 'base64url')), decipher.final()])
    return JSON.parse(out.toString('utf8'))
  } catch {
    return null
  }
}

export interface ResolvedSessionConfig {
  driver: 'cookie' | 'memory' | 'file' | 'database'
  cookie: string
  lifetime: number
  secret: string
  /** Filesystem directory for the `file` driver (resolved by the Application). */
  files: string
  path: string
  domain?: string
  secure: boolean
  httpOnly: boolean
  sameSite: 'lax' | 'strict' | 'none'
  /** Drop `maxAge` so the cookie expires when the browser closes. */
  expireOnClose: boolean
}

/** Server-side session store, keyed by session id (for memory/file/database drivers). */
export interface SessionStore {
  read(id: string): Promise<Record<string, unknown>>
  write(id: string, data: Record<string, unknown>, lifetimeSeconds: number): Promise<void>
}

class MemorySessionStore implements SessionStore {
  private readonly map = new Map<string, { data: Record<string, unknown>; expiresAt: number }>()
  async read(id: string): Promise<Record<string, unknown>> {
    const entry = this.map.get(id)
    if (!entry) return {}
    if (Date.now() >= entry.expiresAt) {
      this.map.delete(id)
      return {}
    }
    return entry.data
  }
  async write(id: string, data: Record<string, unknown>, lifetime: number): Promise<void> {
    this.map.set(id, { data, expiresAt: Date.now() + lifetime * 1000 })
  }
}

class FileSessionStore implements SessionStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true })
  }
  private path(id: string): string {
    return join(this.dir, `${createHash('sha256').update(id).digest('hex')}.json`)
  }
  async read(id: string): Promise<Record<string, unknown>> {
    const file = this.path(id)
    if (!existsSync(file)) return {}
    try {
      const entry = JSON.parse(readFileSync(file, 'utf8')) as {
        data: Record<string, unknown>
        expiresAt: number
      }
      if (Date.now() >= entry.expiresAt) {
        unlinkSync(file)
        return {}
      }
      return entry.data
    } catch {
      return {}
    }
  }
  async write(id: string, data: Record<string, unknown>, lifetime: number): Promise<void> {
    writeFileSync(this.path(id), JSON.stringify({ data, expiresAt: Date.now() + lifetime * 1000 }))
  }
}

/** DB adapter for the `database` session driver (kept DB-agnostic, wired by the app). */
export interface SessionDbAdapter {
  read(id: string): Promise<string | undefined>
  write(id: string, payload: string, lastActivity: number): Promise<void>
}
let sessionDbAdapter: SessionDbAdapter | null = null
export function configureDatabaseSession(adapter: SessionDbAdapter): void {
  sessionDbAdapter = adapter
}

class DatabaseSessionStore implements SessionStore {
  private adapter(): SessionDbAdapter {
    if (!sessionDbAdapter) {
      throw new Error('[elysia-ravel] database session driver needs configureDatabaseSession(...).')
    }
    return sessionDbAdapter
  }
  async read(id: string): Promise<Record<string, unknown>> {
    const payload = await this.adapter().read(id)
    if (!payload) return {}
    try {
      const entry = JSON.parse(payload) as { data: Record<string, unknown>; expiresAt: number }
      if (Date.now() >= entry.expiresAt) return {}
      return entry.data
    } catch {
      return {}
    }
  }
  async write(id: string, data: Record<string, unknown>, lifetime: number): Promise<void> {
    const payload = JSON.stringify({ data, expiresAt: Date.now() + lifetime * 1000 })
    await this.adapter().write(id, payload, Math.floor(Date.now() / 1000))
  }
}

function makeStore(driver: ResolvedSessionConfig['driver'], files: string): SessionStore | null {
  if (driver === 'file') return new FileSessionStore(files)
  if (driver === 'database') return new DatabaseSessionStore()
  if (driver === 'memory') return new MemorySessionStore()
  return null // cookie driver has no server-side store
}

/**
 * Elysia plugin: load the session from the cookie (or memory store) into
 * `ctx.session`, and persist it (aging flash) on the way out. Mounted by the
 * Application before routes when `config/session.ts` is present.
 */
export function sessionPlugin(config: ResolvedSessionConfig): Elysia {
  const store = makeStore(config.driver, config.files)

  // biome-ignore lint/suspicious/noExplicitAny: Elysia generics vary with derive/hooks
  const plugin: any = new Elysia({ name: 'ravel-session' })
    .derive({ as: 'global' }, async ({ cookie }) => {
      const raw = cookie[config.cookie]?.value as string | undefined
      let sid: string | undefined
      let data: Record<string, unknown> = {}
      if (store) {
        sid = raw
        data = sid ? await store.read(sid) : {}
      } else {
        data = raw ? (decrypt(raw, config.secret) ?? {}) : {} // cookie driver
      }
      const session = new Session(data)
      session.ensureToken()
      return { session, __sid: sid }
    })
    .onAfterHandle({ as: 'global' }, async (ctx: Record<string, unknown>) => {
      const session = ctx.session as Session | undefined
      if (!session) return
      // biome-ignore lint/suspicious/noExplicitAny: Elysia cookie proxy
      const cookie = ctx.cookie as any
      session.ageFlashData()

      let value: string
      if (store) {
        const sid = (ctx.__sid as string) || randomBytes(16).toString('hex')
        await store.write(sid, session.toData(), config.lifetime)
        value = sid
      } else {
        value = encrypt(session.toData(), config.secret) // cookie driver
      }
      const base = {
        path: config.path,
        domain: config.domain,
        secure: config.secure,
        sameSite: config.sameSite,
        ...(config.expireOnClose ? {} : { maxAge: config.lifetime }),
      }
      cookie[config.cookie].value = value
      cookie[config.cookie].set({ ...base, httpOnly: config.httpOnly })
      // Readable token cookie for SPA double-submit (Axios reads XSRF-TOKEN).
      cookie['XSRF-TOKEN'].value = session.token()
      cookie['XSRF-TOKEN'].set({ ...base, httpOnly: false })
    })

  return plugin as Elysia
}

/** Extract the request's CSRF token: `_token` body field or X-CSRF/XSRF header. */
function requestToken(ctx: MiddlewareContext): string | undefined {
  const body = ctx.body as Record<string, unknown> | undefined
  const fromBody = body && typeof body === 'object' ? body._token : undefined
  if (typeof fromBody === 'string') return fromBody
  return (
    ctx.request.headers.get('x-csrf-token') ??
    ctx.request.headers.get('x-xsrf-token') ??
    undefined
  )
}

/**
 * CSRF protection for state-changing requests. Registered as the built-in
 * `csrf` alias — apply with `{ middleware: 'csrf' }` (needs sessions enabled).
 * Verifies the request token against the session token; 419 on mismatch.
 */
export class CsrfMiddleware extends Middleware {
  handle(ctx: MiddlewareContext) {
    const method = ctx.request.method
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return
    const session = ctx.session as Session | undefined
    if (!session) return // sessions not enabled → nothing to verify
    if (requestToken(ctx) !== session.token()) {
      return ctx.status(419, { message: 'CSRF token mismatch.' })
    }
  }
}
