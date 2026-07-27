import { createConnection, hasColumn, SchemaBuilder, setConnection } from '@elyvel/database'
import { twoFactor } from 'better-auth/plugins'
import { afterEach, describe, expect, test } from 'bun:test'
import { migrateBetterAuth } from '../src/better-auth-schema'
import { defineAuth, enabledSocialProviders } from '../src/define-auth'

const ENV_KEYS = ['APP_NAME', 'APP_KEY']
const saved: Record<string, string | undefined> = {}
for (const k of ENV_KEYS) saved[k] = process.env[k]
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined)
      delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('defineAuth', () => {
  test('pre-wires cookie prefix (from APP_NAME) + secret; passes plugins through', () => {
    process.env.APP_NAME = 'Fullstack Vue'
    process.env.APP_KEY = 'base64:test-key'
    const auth = defineAuth({ plugins: [twoFactor()] })
    expect(auth.options.advanced?.cookiePrefix).toBe('fullstack_vue')
    expect(auth.options.secret).toBe('base64:test-key')
    expect(auth.options.plugins?.some(p => p.id === 'two-factor')).toBe(true)
  })

  test('native options override the framework defaults', () => {
    const auth = defineAuth({ advanced: { cookiePrefix: 'myapp' }, plugins: [] })
    expect(auth.options.advanced?.cookiePrefix).toBe('myapp')
    expect(auth.options.plugins?.some(p => p.id === 'two-factor')).toBe(false)
  })

  test('social providers come straight from the passed options', () => {
    expect(enabledSocialProviders(defineAuth({}))).toEqual([])
    expect(
      enabledSocialProviders(
        defineAuth({ socialProviders: { github: { clientId: 'id', clientSecret: 'secret' } } }),
      ),
    ).toEqual(['github'])
  })

  test('core tables are plural (Eloquent convention)', async () => {
    const conn = await createConnection({ driver: 'sqlite', database: ':memory:' })
    setConnection(conn)
    const tables = await migrateBetterAuth(new SchemaBuilder(conn), defineAuth({}).options)
    expect(tables).toEqual(expect.arrayContaining(['users', 'sessions', 'accounts', 'verifications']))
    expect(tables).not.toContain('user')
  })

  test('the built instance runs on the Eloquent adapter (migrate + 2FA plugin table)', async () => {
    process.env.APP_KEY = 'base64:test-key'
    const auth = defineAuth({ plugins: [twoFactor()] })
    const conn = await createConnection({ driver: 'sqlite', database: ':memory:' })
    setConnection(conn)
    const created = await migrateBetterAuth(new SchemaBuilder(conn), auth.options)
    expect(created).toContain('users')
    expect(created).toContain('twoFactor')
  })

  test('core columns are snake_case, matching every other Eloquent table', async () => {
    const conn = await createConnection({ driver: 'sqlite', database: ':memory:' })
    setConnection(conn)
    await migrateBetterAuth(new SchemaBuilder(conn), defineAuth({}).options)

    expect(await hasColumn(conn, 'users', 'email_verified')).toBe(true)
    expect(await hasColumn(conn, 'users', 'created_at')).toBe(true)
    expect(await hasColumn(conn, 'users', 'updated_at')).toBe(true)
    expect(await hasColumn(conn, 'users', 'emailVerified')).toBe(false)

    expect(await hasColumn(conn, 'accounts', 'account_id')).toBe(true)
    expect(await hasColumn(conn, 'accounts', 'provider_id')).toBe(true)
    expect(await hasColumn(conn, 'accounts', 'user_id')).toBe(true)
    expect(await hasColumn(conn, 'accounts', 'access_token')).toBe(true)
    expect(await hasColumn(conn, 'accounts', 'userId')).toBe(false)

    expect(await hasColumn(conn, 'sessions', 'user_id')).toBe(true)
    expect(await hasColumn(conn, 'sessions', 'ip_address')).toBe(true)
    expect(await hasColumn(conn, 'sessions', 'user_agent')).toBe(true)

    expect(await hasColumn(conn, 'verifications', 'created_at')).toBe(true)
  })

  test('an explicit fields override on a core model still wins over the snake_case default', async () => {
    const conn = await createConnection({ driver: 'sqlite', database: ':memory:' })
    setConnection(conn)
    const auth = defineAuth({ user: { modelName: 'users', fields: { email: 'email_address' } } } as any)
    await migrateBetterAuth(new SchemaBuilder(conn), auth.options)
    expect(await hasColumn(conn, 'users', 'email_address')).toBe(true)
    expect(await hasColumn(conn, 'users', 'email')).toBe(false)
    // Untouched core fields still get the snake_case default alongside the override.
    expect(await hasColumn(conn, 'users', 'email_verified')).toBe(true)
  })
})
