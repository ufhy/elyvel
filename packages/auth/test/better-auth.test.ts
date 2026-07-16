import { createConnection, SchemaBuilder, setConnection, table } from '@elysia-ravel/database'
import { betterAuth } from 'better-auth'
import { beforeEach, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { betterAuthPlugin } from '../src/better-auth'
import { migrateBetterAuth } from '../src/better-auth-schema'
import { eloquentAdapter } from '../src/eloquent-adapter'

// Better Auth running entirely on the Eloquent adapter — one connection, no
// separate DB. If sign-up writes a row we can read back via table('user'), the
// adapter's create/findOne/where translation all work end-to-end.
const auth = betterAuth({
  database: eloquentAdapter(),
  emailAndPassword: { enabled: true },
  secret: 'test-secret-please-change-please',
  baseURL: 'http://localhost',
})
const app: any = new Elysia()
  .use(betterAuthPlugin(auth))
  .get('/me', ({ user }: any) => user, { auth: true })
  .get('/verified-only', () => ({ ok: true }), { verified: true })

// Fresh in-memory DB + Better Auth tables for each test (isolated).
beforeEach(async () => {
  const conn = await createConnection({ driver: 'sqlite', database: ':memory:' })
  setConnection(conn)
  await migrateBetterAuth(new SchemaBuilder(conn), auth.options)
})

function signUp(email: string) {
  return app.handle(
    new Request('http://localhost/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ada', email, password: 'password123' }),
    }),
  )
}

describe('Better Auth over the Eloquent adapter', () => {
  test('sign-up persists the user through table()', async () => {
    const res = await signUp('ada@x.test')
    expect(res.status).toBe(200)
    const row = await table('user').where('email', 'ada@x.test').first()
    expect(row?.name).toBe('Ada')
    expect(String(row?.email)).toBe('ada@x.test')
  })

  test('guards: API guest → 401, browser guest → redirect to /login, cookie → 200', async () => {
    const res = await signUp('grace@x.test')
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]

    // API/JSON client gets a 401 to handle itself.
    const api = await app.handle(new Request('http://localhost/me', { headers: { accept: 'application/json' } }))
    expect(api.status).toBe(401)
    // A browser navigation is redirected to the login page instead of raw JSON.
    const browser = await app.handle(new Request('http://localhost/me', { headers: { accept: 'text/html' } }))
    expect(browser.status).toBe(302)
    expect(browser.headers.get('location')).toBe('/login')
    // Authenticated → through.
    const me = await app.handle(new Request('http://localhost/me', { headers: { cookie } }))
    expect(me.status).toBe(200)
    expect(((await me.json()) as { email: string }).email).toBe('grace@x.test')
  })

  test('verified macro: API 401/403; browser redirects (login / verify-email)', async () => {
    const res = await signUp('mia@x.test')
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]

    // guest, API → 401
    const guestApi = await app.handle(new Request('http://localhost/verified-only', { headers: { accept: 'application/json' } }))
    expect(guestApi.status).toBe(401)
    // freshly signed-up user isn't verified yet — API → 403
    const unverifiedApi = await app.handle(new Request('http://localhost/verified-only', { headers: { accept: 'application/json', cookie } }))
    expect(unverifiedApi.status).toBe(403)
    // same unverified user in a browser → redirected to the verify notice
    const unverifiedBrowser = await app.handle(new Request('http://localhost/verified-only', { headers: { accept: 'text/html', cookie } }))
    expect(unverifiedBrowser.status).toBe(302)
    expect(unverifiedBrowser.headers.get('location')).toBe('/verify-email')
  })

  test('sign-in verifies credentials via the adapter', async () => {
    await signUp('sam@x.test')
    const ok = await app.handle(
      new Request('http://localhost/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'sam@x.test', password: 'password123' }),
      }),
    )
    expect(ok.status).toBe(200)
    const bad = await app.handle(
      new Request('http://localhost/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'sam@x.test', password: 'wrongpass123' }),
      }),
    )
    expect(bad.status).toBeGreaterThanOrEqual(400)
  })
})
