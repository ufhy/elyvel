import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { registerMiddlewareRegistry, route } from '../src/middleware'
import { CsrfMiddleware, type ResolvedSessionConfig, sessionPlugin } from '../src/session'

const cfg: ResolvedSessionConfig = {
  driver: 'cookie',
  cookie: 'ravel_session',
  lifetime: 7200,
  secret: 'test-secret',
}

/** Build a Cookie request header from a response's Set-Cookie list. */
function jar(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
}

describe('session (cookie driver)', () => {
  const app = new Elysia().use(sessionPlugin(cfg)).use(
    route()
      // biome-ignore lint/suspicious/noExplicitAny: derived session
      .get('/put', ({ session }: any) => {
        session.put('name', 'Ada')
        return 'ok'
      })
      // biome-ignore lint/suspicious/noExplicitAny: derived session
      .get('/name', ({ session }: any) => ({ name: session.get('name') ?? null }))
      // biome-ignore lint/suspicious/noExplicitAny: derived session
      .get('/flash', ({ session }: any) => {
        session.flash('msg', 'saved!')
        return 'ok'
      })
      // biome-ignore lint/suspicious/noExplicitAny: derived session
      .get('/msg', ({ session }: any) => ({ msg: session.get('msg') ?? null })),
  )

  test('put persists across requests', async () => {
    const r1 = await app.handle(new Request('http://localhost/put'))
    const r2 = await app.handle(new Request('http://localhost/name', { headers: { cookie: jar(r1) } }))
    expect(await r2.json()).toEqual({ name: 'Ada' })
  })

  test('flash is available next request only', async () => {
    const r1 = await app.handle(new Request('http://localhost/flash'))
    const r2 = await app.handle(new Request('http://localhost/msg', { headers: { cookie: jar(r1) } }))
    expect(await r2.json()).toEqual({ msg: 'saved!' }) // available once
    const r3 = await app.handle(new Request('http://localhost/msg', { headers: { cookie: jar(r2) } }))
    expect(await r3.json()).toEqual({ msg: null }) // expired
  })
})

describe('CSRF', () => {
  registerMiddlewareRegistry({ aliases: { csrf: CsrfMiddleware } })
  const app = new Elysia().use(sessionPlugin(cfg)).use(
    route()
      // biome-ignore lint/suspicious/noExplicitAny: derived session
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
