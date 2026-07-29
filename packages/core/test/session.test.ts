import type { ResolvedSessionConfig } from '../src/session'
import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { registerMiddlewareRegistry, route } from '../src/middleware'
import { CsrfMiddleware, FileSessionStore, MemorySessionStore, sessionPlugin } from '../src/session'

const cfg: ResolvedSessionConfig = {
  driver: 'cookie',
  cookie: 'elyvel_session',
  lifetime: 7200,
  secret: 'test-secret',
  files: '/tmp/elyvel-test-sessions',
  path: '/',
  secure: false,
  httpOnly: true,
  sameSite: 'lax',
  expireOnClose: false,
}

/** Build a Cookie request header from a response's Set-Cookie list. */
function jar(res: Response): string {
  return res.headers
    .getSetCookie()
    .map(c => c.split(';')[0])
    .join('; ')
}

describe('session (cookie driver)', () => {
  const app = new Elysia().use(sessionPlugin(cfg)).use(
    route()
      .get('/put', ({ session }: any) => {
        session.put('name', 'Ada')
        return 'ok'
      })
      .get('/name', ({ session }: any) => ({ name: session.get('name') ?? null }))
      .get('/flash', ({ session }: any) => {
        session.flash('msg', 'saved!')
        return 'ok'
      })
      .get('/msg', ({ session }: any) => ({ msg: session.get('msg') ?? null })),
  )

  test('put persists across requests', async () => {
    const r1 = await app.handle(new Request('http://localhost/put'))
    const r2 = await app.handle(
      new Request('http://localhost/name', { headers: { cookie: jar(r1) } }),
    )
    expect(await r2.json()).toEqual({ name: 'Ada' })
  })

  test('flash is available next request only', async () => {
    const r1 = await app.handle(new Request('http://localhost/flash'))
    const r2 = await app.handle(
      new Request('http://localhost/msg', { headers: { cookie: jar(r1) } }),
    )
    expect(await r2.json()).toEqual({ msg: 'saved!' }) // available once
    const r3 = await app.handle(
      new Request('http://localhost/msg', { headers: { cookie: jar(r2) } }),
    )
    expect(await r3.json()).toEqual({ msg: null }) // expired
  })

  // Regression: the encrypted payload used to carry NO expiry, so `lifetime`
  // only reached the browser as `Max-Age` — a hint an attacker replaying a
  // captured cookie simply ignores. A cookie stolen once stayed valid forever.
  // The lifetime is now stamped into the signed payload and checked on read.
  test('a captured cookie stops working once the lifetime has elapsed', async () => {
    const shortLived = new Elysia().use(sessionPlugin({ ...cfg, lifetime: 1 })).use(
      route()
        .get('/in', ({ session }: any) => {
          session.put('user', 42)
          return 'ok'
        })
        .get('/who', ({ session }: any) => ({ user: session.get('user') ?? null })),
    )
    const captured = jar(await shortLived.handle(new Request('http://localhost/in')))

    const fresh = await shortLived.handle(
      new Request('http://localhost/who', { headers: { cookie: captured } }),
    )
    expect(await fresh.json()).toEqual({ user: 42 })

    await new Promise(resolve => setTimeout(resolve, 1600)) // past the 1s lifetime
    const replayed = await shortLived.handle(
      new Request('http://localhost/who', { headers: { cookie: captured } }),
    )
    expect(await replayed.json()).toEqual({ user: null })
  })

  test('a payload with no expiry envelope is rejected (fails closed)', async () => {
    // Exactly the pre-fix on-the-wire shape: a bare data object, no expiry.
    const { createCipheriv, createHash, randomBytes } = require('node:crypto') as typeof import('node:crypto')
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(cfg.secret).digest(), iv)
    const enc = Buffer.concat([cipher.update(JSON.stringify({ user: 99 }), 'utf8'), cipher.final()])
    const legacy = `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${enc.toString('base64url')}`

    const res = await app.handle(
      new Request('http://localhost/name', { headers: { cookie: `${cfg.cookie}=${legacy}` } }),
    )
    expect(await res.json()).toEqual({ name: null }) // not honored
  })
})

describe('server-side session drivers (memory / file / database)', () => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs')
  const { tmpdir } = require('node:os') as typeof import('node:os')
  const dir = mkdtempSync(`${tmpdir()}/elyvel-sess-`)

  // in-memory adapter for the database driver
  const dbRows = new Map<string, string>()
  const { configureDatabaseSession } = require('../src/session') as typeof import('../src/session')
  configureDatabaseSession({
    read: async id => dbRows.get(id),
    write: async (id, payload) => void dbRows.set(id, payload),
    destroy: async id => void dbRows.delete(id),
  })

  const drivers = ['memory', 'file', 'database'] as const
  for (const driver of drivers) {
    test(`${driver}: persists across requests via session id`, async () => {
      const app = new Elysia().use(sessionPlugin({ ...cfg, driver, files: dir })).use(
        route()
          .get('/set', ({ session }: any) => {
            session.put('who', driver)
            return 'ok'
          })
          .get('/get', ({ session }: any) => ({ who: session.get('who') ?? null })),
      )
      const r1 = await app.handle(new Request('http://localhost/set'))
      const r2 = await app.handle(
        new Request('http://localhost/get', { headers: { cookie: jar(r1) } }),
      )
      expect(await r2.json()).toEqual({ who: driver })
    })
  }

  // Anti session-fixation: regenerate()/invalidate() must rotate the actual
  // server-side session id, not just the CSRF token — otherwise an attacker
  // who fixates a session id on a victim before login keeps a valid,
  // now-authenticated session under that same id after the victim logs in.
  for (const driver of drivers) {
    test(`${driver}: regenerate() issues a new session id and kills the old one`, async () => {
      const app = new Elysia().use(sessionPlugin({ ...cfg, driver, files: dir })).use(
        route()
          .get('/anon', ({ session }: any) => {
            session.put('stage', 'anonymous')
            return 'ok'
          })
          .get('/login', ({ session }: any) => {
            session.put('user', 'ada')
            session.regenerate() // à la calling this right after authenticating
            return 'ok'
          })
          .get('/whoami', ({ session }: any) => ({ user: session.get('user') ?? null })),
      )

      // The attacker "fixates" this cookie (captured before the victim logs in).
      const anon = await app.handle(new Request('http://localhost/anon'))
      const fixatedCookie = jar(anon)

      // The victim (using the attacker's fixated cookie) logs in.
      const login = await app.handle(
        new Request('http://localhost/login', { headers: { cookie: fixatedCookie } }),
      )
      const newCookie = jar(login)
      expect(newCookie).not.toBe(fixatedCookie) // the session id itself changed

      // The OLD (attacker-known) cookie must no longer reach the authenticated session.
      const replayed = await app.handle(
        new Request('http://localhost/whoami', { headers: { cookie: fixatedCookie } }),
      )
      expect(await replayed.json()).toEqual({ user: null })

      // The NEW cookie (only known after login) correctly sees the session.
      const legit = await app.handle(
        new Request('http://localhost/whoami', { headers: { cookie: newCookie } }),
      )
      expect(await legit.json()).toEqual({ user: 'ada' })
    })
  }
})

describe('redis session store (fake client — logic only)', () => {
  test('read/write round-trip + expiry', async () => {
    const { RedisSessionStore } = require('../src/session') as typeof import('../src/session')
    const map = new Map<string, string>()
    const client = {
      async send(command: string, args: string[]) {
        if (command === 'GET')
          return map.get(args[0] as string) ?? null
        if (command === 'SET')
          return void map.set(args[0] as string, args[1] as string)
        return null
      },
    }
    const store = new RedisSessionStore(client)
    await store.write('sid1', { user: 7 }, 60)
    expect(await store.read('sid1')).toEqual({ user: 7 })
    expect(await store.read('missing')).toEqual({})
  })
})

describe('session convenience methods', () => {
  test('push/pull/increment/decrement/remember/exists/missing', () => {
    const { Session } = require('../src/session') as typeof import('../src/session')
    const s = new Session()
    s.push('list', 'a')
    s.push('list', 'b')
    expect(s.get<string[]>('list')).toEqual(['a', 'b'])

    s.put('n', 5)
    expect(s.increment('n')).toBe(6)
    expect(s.decrement('n', 2)).toBe(4)

    s.put('temp', 'x')
    expect(s.pull<string>('temp')).toBe('x')
    expect(s.exists('temp')).toBe(false)

    expect(s.remember('cached', () => 42)).toBe(42)
    expect(s.remember('cached', () => 99)).toBe(42) // already stored

    s.put('nullable', null)
    expect(s.exists('nullable')).toBe(true) // present even if null
    expect(s.has('nullable')).toBe(false) // but null → not "has"
    expect(s.missing('nope')).toBe(true)
  })

  test('invalidate clears data, rotates the token, and flags the id for regeneration', () => {
    const { Session } = require('../src/session') as typeof import('../src/session')
    const s = new Session({ a: 1 })
    s.ensureToken()
    const before = s.token()
    expect(s.shouldRegenerateId()).toBe(false)
    s.invalidate()
    expect(s.get('a')).toBeUndefined()
    expect(s.token()).not.toBe(before)
    expect(s.shouldRegenerateId()).toBe(true)
  })

  test('regenerate() flags the id for regeneration; markIdRegenerated() clears it', () => {
    const { Session } = require('../src/session') as typeof import('../src/session')
    const s = new Session({ a: 1 })
    s.regenerate()
    expect(s.shouldRegenerateId()).toBe(true)
    expect(s.get<number>('a')).toBe(1) // data is kept, unlike invalidate()
    s.markIdRegenerated()
    expect(s.shouldRegenerateId()).toBe(false)
  })
})

describe('CSRF', () => {
  registerMiddlewareRegistry({ aliases: { csrf: CsrfMiddleware } })
  const app = new Elysia().use(sessionPlugin(cfg)).use(
    route()
      .get('/token', ({ session }: any) => ({ token: session.token() }))
      .post('/do', () => 'done', { middleware: 'csrf' }),
  )

  test('rejects writes without a valid token (419), accepts with it', async () => {
    const g = await app.handle(new Request('http://localhost/token'))
    const token = ((await g.json()) as { token: string }).token
    const cookie = jar(g)

    const bad = await app.handle(
      new Request('http://localhost/do', { method: 'POST', headers: { cookie } }),
    )
    expect(bad.status).toBe(419)

    const ok = await app.handle(
      new Request('http://localhost/do', {
        method: 'POST',
        headers: { cookie, 'x-csrf-token': token },
      }),
    )
    expect(ok.status).toBe(200)
    expect(await ok.text()).toBe('done')
  })

  test('GET is never blocked', async () => {
    expect((await app.handle(new Request('http://localhost/token'))).status).toBe(200)
  })
})

describe('session garbage collection', () => {
  test('MemorySessionStore.gc() sweeps expired entries', async () => {
    const store = new MemorySessionStore()
    await store.write('fresh', { a: 1 }, 3600) // 1h — not expired
    await store.write('stale', { a: 2 }, -1) // already expired
    await store.gc()
    expect(await store.read('fresh')).toEqual({ a: 1 })
    expect(await store.read('stale')).toEqual({}) // gone, not just "expired on read"
  })

  test('FileSessionStore.gc() sweeps expired entries from disk', async () => {
    const { mkdtempSync } = require('node:fs') as typeof import('node:fs')
    const { tmpdir } = require('node:os') as typeof import('node:os')
    const dir = mkdtempSync(`${tmpdir()}/elyvel-sess-gc-`)
    const store = new FileSessionStore(dir)
    await store.write('fresh', { a: 1 }, 3600)
    await store.write('stale', { a: 2 }, -1)
    await store.gc()
    expect(await store.read('fresh')).toEqual({ a: 1 })
    expect(await store.read('stale')).toEqual({})
  })

  test('the lottery only runs gc() on the configured odds', async () => {
    const { configureDatabaseSession } = require('../src/session') as typeof import('../src/session')
    let gcCalls = 0
    configureDatabaseSession({
      read: async () => undefined,
      write: async () => {},
      destroy: async () => {},
      gc: async () => { gcCalls++ },
    })

    const never = new Elysia().use(sessionPlugin({ ...cfg, driver: 'database', lottery: [0, 100] })).use(
      route().get('/x', ({ session }: any) => {
        session.put('a', 1)
        return 'ok'
      }),
    )
    for (let i = 0; i < 20; i++) await never.handle(new Request('http://localhost/x'))
    expect(gcCalls).toBe(0) // odds [0,100] — never triggers

    gcCalls = 0
    const always = new Elysia().use(sessionPlugin({ ...cfg, driver: 'database', lottery: [100, 100] })).use(
      route().get('/x', ({ session }: any) => {
        session.put('a', 1)
        return 'ok'
      }),
    )
    for (let i = 0; i < 5; i++) await always.handle(new Request('http://localhost/x'))
    expect(gcCalls).toBe(5) // odds [100,100] — always triggers
  })
})
