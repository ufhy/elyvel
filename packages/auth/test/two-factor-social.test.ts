import { createConnection, SchemaBuilder, setConnection, table } from '@elyvel/database'
import { betterAuth } from 'better-auth'
import { twoFactor } from 'better-auth/plugins'
import { beforeEach, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { betterAuthPlugin } from '../src/better-auth'
import { migrateBetterAuth } from '../src/better-auth-schema'
import { eloquentAdapter } from '../src/eloquent-adapter'

// Better Auth with the twoFactor() plugin + a social provider, all on the
// Eloquent adapter. Proves migrateBetterAuth derives the plugin schema, the
// adapter persists 2FA rows, and the social/2FA routes mount through our plugin.
const auth = betterAuth({
  database: eloquentAdapter(),
  emailAndPassword: { enabled: true },
  socialProviders: { github: { clientId: 'gh-id', clientSecret: 'gh-secret' } },
  plugins: [twoFactor()],
  secret: 'test-secret-please-change-please',
  baseURL: 'http://localhost',
})
const app: any = new Elysia().use(betterAuthPlugin({ instance: auth }))

beforeEach(async () => {
  const conn = await createConnection({ driver: 'sqlite', database: ':memory:' })
  setConnection(conn)
  await migrateBetterAuth(new SchemaBuilder(conn), auth.options)
})

function req(path: string, body: Record<string, unknown>, cookie?: string): Promise<Response> {
  return app.handle(
    new Request(`http://localhost/api/auth/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  )
}

async function signInCookie(email: string): Promise<string> {
  await req('sign-up/email', { name: 'Ada', email, password: 'password123' })
  const res = await req('sign-in/email', { email, password: 'password123' })
  return (res.headers.get('set-cookie') ?? '').split(';')[0] as string
}

describe('migrateBetterAuth derives the twoFactor plugin schema', () => {
  test('creates the twoFactor table + user.twoFactorEnabled column', async () => {
    const conn = await createConnection({ driver: 'sqlite', database: ':memory:' })
    setConnection(conn)
    const created = await migrateBetterAuth(new SchemaBuilder(conn), auth.options)
    expect(created).toContain('twoFactor')
    // the plugin adds a flag column onto the base user table
    const userCols = await conn.select<{ name: string }>('PRAGMA table_info(user)')
    expect(userCols.map(c => c.name)).toContain('twoFactorEnabled')
  })
})

describe('two-factor over the Eloquent adapter', () => {
  test('enable returns a TOTP URI + backup codes and persists a twoFactor row', async () => {
    const cookie = await signInCookie('tfa@x.test')
    const res = await req('two-factor/enable', { password: 'password123' }, cookie)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { totpURI?: string, backupCodes?: string[] }
    expect(body.totpURI).toContain('otpauth://totp/')
    expect(Array.isArray(body.backupCodes)).toBe(true)
    expect(body.backupCodes?.length ?? 0).toBeGreaterThan(0)

    // the adapter wrote the secret/backup row for this user
    const user = await table('user').where('email', 'tfa@x.test').first()
    const row = await table('twoFactor').where('userId', String(user?.id)).first()
    expect(row).toBeDefined()
    expect(String(row?.secret).length).toBeGreaterThan(0)
  })

  test('enable requires the correct password (guards the flow)', async () => {
    const cookie = await signInCookie('tfa2@x.test')
    const bad = await req('two-factor/enable', { password: 'wrong-password' }, cookie)
    expect(bad.status).toBeGreaterThanOrEqual(400)
  })

  test('two-factor routes are guarded for guests (mounted, not 404)', async () => {
    const res = await req('two-factor/enable', { password: 'x' })
    expect(res.status).toBe(401) // mounted + auth-guarded, not missing
  })
})

describe('social sign-in over our plugin', () => {
  test('returns an OAuth redirect URL for a configured provider', async () => {
    const res = await req('sign-in/social', { provider: 'github', callbackURL: '/dashboard' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { url?: string, redirect?: boolean }
    expect(body.url).toContain('github.com')
  })
})
