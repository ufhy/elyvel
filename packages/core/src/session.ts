import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
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

  get<T = unknown>(key: string, fallback?: T): T {
    return (key in this.data ? this.data[key] : fallback) as T
  }
  put(key: string, value: unknown): void {
    this.data[key] = value
  }
  has(key: string): boolean {
    return this.data[key] !== undefined && this.data[key] !== null
  }
  forget(key: string): void {
    delete this.data[key]
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
  driver: 'cookie' | 'memory'
  cookie: string
  lifetime: number
  secret: string
}

/**
 * Elysia plugin: load the session from the cookie (or memory store) into
 * `ctx.session`, and persist it (aging flash) on the way out. Mounted by the
 * Application before routes when `config/session.ts` is present.
 */
export function sessionPlugin(config: ResolvedSessionConfig): Elysia {
  const memory = new Map<string, Record<string, unknown>>()

  // biome-ignore lint/suspicious/noExplicitAny: Elysia generics vary with derive/hooks
  const plugin: any = new Elysia({ name: 'ravel-session' })
    .derive({ as: 'global' }, ({ cookie }) => {
      const raw = cookie[config.cookie]?.value as string | undefined
      let sid: string | undefined
      let data: Record<string, unknown> = {}
      if (config.driver === 'cookie') {
        data = raw ? (decrypt(raw, config.secret) ?? {}) : {}
      } else {
        sid = raw
        data = (sid && memory.get(sid)) || {}
      }
      const session = new Session(data)
      session.ensureToken()
      return { session, __sid: sid }
    })
    .onAfterHandle({ as: 'global' }, (ctx: Record<string, unknown>) => {
      const session = ctx.session as Session | undefined
      if (!session) return
      // biome-ignore lint/suspicious/noExplicitAny: Elysia cookie proxy
      const cookie = ctx.cookie as any
      session.ageFlashData()

      let value: string
      if (config.driver === 'cookie') {
        value = encrypt(session.toData(), config.secret)
      } else {
        const sid = (ctx.__sid as string) || randomBytes(16).toString('hex')
        memory.set(sid, session.toData())
        value = sid
      }
      cookie[config.cookie].value = value
      cookie[config.cookie].set({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: config.lifetime })
      // Readable token cookie for SPA double-submit (Axios reads XSRF-TOKEN).
      cookie['XSRF-TOKEN'].value = session.token()
      cookie['XSRF-TOKEN'].set({ httpOnly: false, sameSite: 'lax', path: '/', maxAge: config.lifetime })
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
