import type { MiddlewareContext } from './middleware'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { trans } from '@elyvel/support'
import { RedisClient } from 'bun'
import { Elysia } from 'elysia'
import { expectsJson } from './http/negotiation'
import { Middleware } from './middleware'

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
  private regenerateId = false

  constructor(data: Record<string, unknown> = {}) {
    this.data = { ...data }
  }

  /**
   * Whether the server-side session id must be rotated on save — set by
   * `regenerate()`/`invalidate()`. Checked by `sessionPlugin`'s `persist()`.
   */
  shouldRegenerateId(): boolean {
    return this.regenerateId
  }

  /** Clears the regenerate-id flag once `persist()` has acted on it. */
  markIdRegenerated(): void {
    this.regenerateId = false
  }

  /** Ensure a CSRF token exists (called when the session starts). */
  ensureToken(): void {
    if (typeof this.data[TOKEN_KEY] !== 'string')
      this.data[TOKEN_KEY] = randomBytes(20).toString('hex')
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
    if (this.exists(key))
      return this.get<T>(key) as T
    const value = factory()
    this.put(key, value)
    return value
  }

  /**
   * Rotate the CSRF token AND the server-side session id, keeping session
   * data (anti session-fixation — call this right after a successful login).
   * The id rotation only matters for store-backed drivers (memory/file/
   * database/redis); the `cookie` driver has no separate id to fixate.
   */
  regenerate(): void {
    this.regenerateToken()
    this.regenerateId = true
  }

  /** Clear all data, and rotate the token AND the server-side session id. */
  invalidate(): void {
    this.flush()
    this.regenerateToken()
    this.regenerateId = true
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
    if (!flash.new.includes(key))
      flash.new.push(key)
    flash.old = flash.old.filter(k => k !== key)
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
    flash.old = flash.old.filter(k => !keys.includes(k))
  }

  private flashState(): FlashState {
    if (!this.data[FLASH_KEY])
      this.data[FLASH_KEY] = { old: [], new: [] }
    return this.data[FLASH_KEY] as FlashState
  }

  /** Expire last request's flash, promote this request's flash (called on save). */
  ageFlashData(): void {
    const flash = this.flashState()
    for (const key of flash.old) {
      if (!flash.new.includes(key))
        delete this.data[key]
    }
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
    const decipher = createDecipheriv(
      'aes-256-gcm',
      keyFrom(secret),
      Buffer.from(iv as string, 'base64url'),
    )
    decipher.setAuthTag(Buffer.from(tag as string, 'base64url'))
    const out = Buffer.concat([
      decipher.update(Buffer.from(enc as string, 'base64url')),
      decipher.final(),
    ])
    return JSON.parse(out.toString('utf8'))
  }
  catch {
    return null
  }
}

export interface ResolvedSessionConfig {
  driver: 'cookie' | 'memory' | 'file' | 'database' | 'redis'
  cookie: string
  lifetime: number
  secret: string
  /** Filesystem directory for the `file` driver (resolved by the Application). */
  files: string
  /** Connection URL for the `redis` driver (default: Bun's REDIS_URL / localhost). */
  redisUrl?: string
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
  /**
   * Delete a session outright — used when regenerating the id, so the OLD
   * (possibly fixated) id can't still be replayed after rotation.
   */
  destroy(id: string): Promise<void>
}

class MemorySessionStore implements SessionStore {
  private readonly map = new Map<string, { data: Record<string, unknown>, expiresAt: number }>()
  async read(id: string): Promise<Record<string, unknown>> {
    const entry = this.map.get(id)
    if (!entry)
      return {}
    if (Date.now() >= entry.expiresAt) {
      this.map.delete(id)
      return {}
    }
    return entry.data
  }

  async write(id: string, data: Record<string, unknown>, lifetime: number): Promise<void> {
    this.map.set(id, { data, expiresAt: Date.now() + lifetime * 1000 })
  }

  async destroy(id: string): Promise<void> {
    this.map.delete(id)
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
    if (!existsSync(file))
      return {}
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
    }
    catch {
      return {}
    }
  }

  async write(id: string, data: Record<string, unknown>, lifetime: number): Promise<void> {
    writeFileSync(this.path(id), JSON.stringify({ data, expiresAt: Date.now() + lifetime * 1000 }))
  }

  async destroy(id: string): Promise<void> {
    const file = this.path(id)
    if (existsSync(file))
      unlinkSync(file)
  }
}

/** DB adapter for the `database` session driver (kept DB-agnostic, wired by the app). */
export interface SessionDbAdapter {
  read(id: string): Promise<string | undefined>
  write(id: string, payload: string, lastActivity: number): Promise<void>
  destroy(id: string): Promise<void>
}
let sessionDbAdapter: SessionDbAdapter | null = null
export function configureDatabaseSession(adapter: SessionDbAdapter): void {
  sessionDbAdapter = adapter
}

class DatabaseSessionStore implements SessionStore {
  private adapter(): SessionDbAdapter {
    if (!sessionDbAdapter) {
      throw new Error('[elyvel] database session driver needs configureDatabaseSession(...).')
    }
    return sessionDbAdapter
  }

  async read(id: string): Promise<Record<string, unknown>> {
    const payload = await this.adapter().read(id)
    if (!payload)
      return {}
    try {
      const entry = JSON.parse(payload) as { data: Record<string, unknown>, expiresAt: number }
      if (Date.now() >= entry.expiresAt)
        return {}
      return entry.data
    }
    catch {
      return {}
    }
  }

  async write(id: string, data: Record<string, unknown>, lifetime: number): Promise<void> {
    const payload = JSON.stringify({ data, expiresAt: Date.now() + lifetime * 1000 })
    await this.adapter().write(id, payload, Math.floor(Date.now() / 1000))
  }

  async destroy(id: string): Promise<void> {
    await this.adapter().destroy(id)
  }
}

/** Redis-backed session store (Bun's built-in Redis client). */
export class RedisSessionStore implements SessionStore {
  constructor(
    private readonly client: { send(command: string, args: string[]): Promise<unknown> },
    private readonly prefix = 'session:',
  ) {}

  async read(id: string): Promise<Record<string, unknown>> {
    const raw = (await this.client.send('GET', [this.prefix + id])) as string | null
    if (!raw)
      return {}
    try {
      const entry = JSON.parse(raw) as { data: Record<string, unknown>, expiresAt: number }
      return Date.now() >= entry.expiresAt ? {} : entry.data
    }
    catch {
      return {}
    }
  }

  async write(id: string, data: Record<string, unknown>, lifetime: number): Promise<void> {
    const payload = JSON.stringify({ data, expiresAt: Date.now() + lifetime * 1000 })
    await this.client.send('SET', [
      this.prefix + id,
      payload,
      'EX',
      String(Math.max(1, Math.ceil(lifetime))),
    ])
  }

  async destroy(id: string): Promise<void> {
    await this.client.send('DEL', [this.prefix + id])
  }
}

function makeStore(config: ResolvedSessionConfig): SessionStore | null {
  switch (config.driver) {
    case 'file':
      return new FileSessionStore(config.files)
    case 'database':
      return new DatabaseSessionStore()
    case 'memory':
      return new MemorySessionStore()
    case 'redis':
      return new RedisSessionStore(
        config.redisUrl ? new RedisClient(config.redisUrl) : new RedisClient(),
      )
    default:
      return null // cookie driver has no server-side store
  }
}

/**
 * Elysia plugin: load the session from the cookie (or memory store) into
 * `ctx.session`, and persist it (aging flash) on the way out. Mounted by the
 * Application before routes when `config/session.ts` is present.
 */
export function sessionPlugin(config: ResolvedSessionConfig): Elysia {
  const store = makeStore(config)

  const plugin: any = new Elysia({ name: 'elyvel-session' })
    .derive({ as: 'global' }, async ({ cookie }) => {
      const raw = cookie[config.cookie]?.value as string | undefined
      let sid: string | undefined
      let data: Record<string, unknown> = {}
      if (store) {
        sid = raw
        data = sid ? await store.read(sid) : {}
      }
      else {
        data = raw ? (decrypt(raw, config.secret) ?? {}) : {} // cookie driver
      }
      const session = new Session(data)
      session.ensureToken()
      return { session, __sid: sid }
    })
    // Persist the session (aging flash) on the happy path.
    .onAfterHandle({ as: 'global' }, (ctx: Record<string, unknown>) => persist(ctx))
    // On error, onAfterHandle is skipped — but we still want the session saved,
    // and web validation errors (422 + bag) to redirect back with the errors and
    // old input flashed, instead of the API-style 422 JSON.
    .onError({ as: 'global' }, async (ctx: Record<string, unknown>) => {
      const session = ctx.session as Session | undefined
      const error = ctx.error as { status?: unknown, errors?: Record<string, unknown> } | undefined
      const request = ctx.request as Request

      const isValidation = error?.status === 422 && error.errors !== undefined
      if (session && isValidation && !expectsJson(request)) {
        // Inertia's `form.errors.field` (and Laravel's own `HandleInertiaRequests`
        // convention) expects one message per field, not the full Laravel-style
        // array — flatten to the first message before flashing.
        const flat = Object.fromEntries(
          Object.entries(error.errors as Record<string, unknown>).map(([field, messages]) => [
            field,
            Array.isArray(messages) ? messages[0] : messages,
          ]),
        )
        session.flash('errors', flat)
        const body = ctx.body
        if (body && typeof body === 'object')
          session.flash('_old_input', body as Record<string, unknown>)
        await persist(ctx)
        const set = ctx.set as any
        set.status = 303
        set.headers.location = request.headers.get('referer') ?? '/'
        return ''
      }
      await persist(ctx) // save any session changes even on other errors
      return undefined
    })

  /** Age flash data and write the session cookie / store (shared by the hooks above). */
  async function persist(ctx: Record<string, unknown>): Promise<void> {
    const session = ctx.session as Session | undefined
    if (!session)
      return
    const cookie = ctx.cookie as any
    session.ageFlashData()

    let value: string
    if (store) {
      const oldSid = ctx.__sid as string | undefined
      const rotate = !oldSid || session.shouldRegenerateId()
      const sid = rotate ? randomBytes(16).toString('hex') : oldSid!
      await store.write(sid, session.toData(), config.lifetime)
      // Kill the old id so a fixated/pre-login cookie can't still be replayed
      // to read the now-authenticated session under the attacker's chosen id.
      if (rotate && oldSid && oldSid !== sid)
        await store.destroy(oldSid)
      session.markIdRegenerated()
      value = sid
    }
    else {
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
  }

  return plugin as Elysia
}

/** Extract the request's CSRF token: `_token` body field or X-CSRF/XSRF header. */
function requestToken(ctx: MiddlewareContext): string | undefined {
  const body = ctx.body as Record<string, unknown> | undefined
  const fromBody = body && typeof body === 'object' ? body._token : undefined
  if (typeof fromBody === 'string')
    return fromBody
  return (
    ctx.request.headers.get('x-csrf-token') ?? ctx.request.headers.get('x-xsrf-token') ?? undefined
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
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS')
      return
    const session = ctx.session as Session | undefined
    if (!session)
      return // sessions not enabled → nothing to verify
    if (requestToken(ctx) !== session.token()) {
      return ctx.status(419, { message: trans('errors.csrf', {}, 'CSRF token mismatch.') })
    }
  }
}
