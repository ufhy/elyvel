import { ConfigRepository, setConfigRepository } from '@elyvel/core'
import { createConnection, SchemaBuilder, setConnection, table } from '@elyvel/database'
import { betterAuth } from 'better-auth'
import { beforeEach, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { composeBefore } from '../src/auth-hooks'
import { betterAuthPlugin } from '../src/better-auth'
import { migrateBetterAuth } from '../src/better-auth-schema'
import { eloquentAdapter } from '../src/eloquent-adapter'
import { actingAs, stopActingAs } from '../src/testing'

// Better Auth running entirely on the Eloquent adapter — one connection, no
// separate DB. If sign-up writes a row we can read back via table('user'), the
// adapter's create/findOne/where translation all work end-to-end. The
// registration `before` hook is what `defineAuth` installs in a real app.
const auth = betterAuth({
  database: eloquentAdapter(),
  emailAndPassword: { enabled: true },
  secret: 'test-secret-please-change-please',
  baseURL: 'http://localhost',
  hooks: { before: composeBefore() },
})
const app: any = new Elysia()
  // Mirror core's error handler just enough to surface a thrown
  // ValidationException as the 422 + error bag the real app would render.
  .onError(({ error, set }: any) => {
    if (error?.isValidationException) {
      set.status = error.status
      return { message: error.message, errors: error.errors }
    }
  })
  .use(betterAuthPlugin({ instance: auth }))
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

  test('sign-up validates input via @elyvel/validation — no raw Better Auth dump leaks', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '', email: 'not-an-email', password: 'short' }),
      }),
    )
    expect(res.status).toBe(422)
    const body = (await res.json()) as { message: string, errors: Record<string, string[]> }
    // Laravel-shaped bag, one entry per failing field.
    expect(body.errors.name).toBeDefined()
    expect(body.errors.email).toBeDefined()
    expect(body.errors.password).toBeDefined()
    // The client-facing message is our clean, framework-shaped text — never
    // Better Auth's raw Zod dump (`[body.email] Invalid email address; ...`).
    expect(body.message).not.toContain('[body')
    // And nothing was persisted — validation ran before Better Auth.
    expect(await table('user').where('email', 'not-an-email').first()).toBeUndefined()
  })

  test('sign-up maps a duplicate email onto the email field', async () => {
    await signUp('dup@x.test')
    const res = await signUp('dup@x.test')
    expect(res.status).toBe(422)
    const body = (await res.json()) as { errors: Record<string, string[]> }
    expect(body.errors.email?.[0]).toBe('This email is already registered.')
  })

  test('validation hook also covers programmatic auth.api.signUpEmail (not just HTTP)', async () => {
    // A custom registration route would call the server API directly — the
    // `before` hook must validate it too, or the framework rules are bypassed.
    let thrown: any
    try {
      await (auth as any).api.signUpEmail({ body: { name: '', email: 'bad', password: 'x' } })
    }
    catch (error) {
      thrown = error
    }
    expect(thrown).toBeDefined()
    expect(thrown?.body?.code).toBe('ELYVEL_VALIDATION')
    expect(thrown?.body?.errors?.email).toBeDefined()
    // And no user was created.
    expect(await table('user').where('email', 'bad').first()).toBeUndefined()

    // A valid programmatic sign-up still goes through.
    const ok = await (auth as any).api.signUpEmail({ body: { name: 'Ada', email: 'prog@x.test', password: 'password123' } })
    expect(ok?.user?.email).toBe('prog@x.test')
  })

  test('password policy also guards change-password and reset-password (same hook)', async () => {
    // change-password: weak newPassword rejected with a field-keyed 422.
    const change = await app.handle(
      new Request('http://localhost/api/auth/change-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword: 'password123', newPassword: 'x' }),
      }),
    )
    expect(change.status).toBe(422)
    expect(((await change.json()) as { errors: Record<string, string[]> }).errors.newPassword).toBeDefined()

    // reset-password: same — validated before Better Auth even checks the token.
    const reset = await app.handle(
      new Request('http://localhost/api/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'whatever', newPassword: 'x' }),
      }),
    )
    expect(reset.status).toBe(422)
    expect(((await reset.json()) as { errors: Record<string, string[]> }).errors.newPassword).toBeDefined()
  })

  test('error normalizer: bad sign-in credentials become a translated envelope', async () => {
    await signUp('norm@x.test')
    const res = await app.handle(
      new Request('http://localhost/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'norm@x.test', password: 'wrongpass123' }),
      }),
    )
    expect(res.status).toBeGreaterThanOrEqual(400)
    const body = (await res.json()) as { message: string, code?: string }
    // Reshaped to our envelope: the friendly translated message, not Better
    // Auth's raw "Invalid email or password" / coded payload.
    expect(body.message).toBe('These credentials do not match our records.')
    expect(body.code).toBeUndefined()
  })

  test('auth macro redirect target comes from config(auth.loginPath) — single source', async () => {
    // The macro must read the same config the AuthGuard/VerifiedGuard middleware
    // do, not a plugin-local option — so there is one place to set it.
    setConfigRepository(new ConfigRepository({ auth: { loginPath: '/masuk' } }))
    try {
      const res = await app.handle(new Request('http://localhost/me', { headers: { accept: 'text/html' } }))
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/masuk')
    }
    finally {
      setConfigRepository(null)
    }
  })

  test('actingAs authenticates requests without a session cookie', async () => {
    const me = () => app.handle(new Request('http://localhost/me', { headers: { accept: 'application/json' } }))

    // guest → 401
    expect((await me()).status).toBe(401)

    // acting as a user → the derive uses it instead of getSession
    actingAs({ id: 'u1', email: 'ada@x.test', emailVerified: true } as any)
    const res = await me()
    expect(res.status).toBe(200)
    expect(((await res.json()) as { email: string }).email).toBe('ada@x.test')

    // cleared → back to guest
    stopActingAs()
    expect((await me()).status).toBe(401)
  })
})
