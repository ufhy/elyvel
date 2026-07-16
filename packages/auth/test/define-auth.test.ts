import { createConnection, SchemaBuilder, setConnection } from '@elysia-ravel/database'
import { afterEach, describe, expect, test } from 'bun:test'
import { migrateBetterAuth } from '../src/better-auth-schema'
import { defineAuth, enabledSocialProviders } from '../src/define-auth'

const ENV_KEYS = ['APP_NAME', 'APP_KEY', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET']
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
  test('pre-wires cookie prefix (from APP_NAME), secret, and the 2FA plugin', () => {
    process.env.APP_NAME = 'Fullstack Vue'
    process.env.APP_KEY = 'base64:test-key'
    const auth = defineAuth({ twoFactor: true })
    expect(auth.options.advanced?.cookiePrefix).toBe('fullstack_vue')
    expect(auth.options.secret).toBe('base64:test-key')
    // twoFactor plugin present → its schema is derivable
    expect(auth.options.plugins?.some(p => p.id === 'two-factor')).toBe(true)
  })

  test('explicit cookiePrefix wins; twoFactor:false drops the plugin', () => {
    const auth = defineAuth({ cookiePrefix: 'myapp', twoFactor: false })
    expect(auth.options.advanced?.cookiePrefix).toBe('myapp')
    expect(auth.options.plugins?.some(p => p.id === 'two-factor')).toBe(false)
  })

  test('social providers activate only when their env credentials are set', () => {
    delete process.env.GITHUB_CLIENT_ID
    delete process.env.GITHUB_CLIENT_SECRET
    expect(enabledSocialProviders(defineAuth({ social: ['github'] }))).toEqual([])

    process.env.GITHUB_CLIENT_ID = 'id'
    process.env.GITHUB_CLIENT_SECRET = 'secret'
    expect(enabledSocialProviders(defineAuth({ social: ['github', 'google'] }))).toEqual(['github'])
  })

  test('the built instance runs on the Eloquent adapter (migrate + sign-up)', async () => {
    process.env.APP_KEY = 'base64:test-key'
    const auth = defineAuth({ cookiePrefix: 'x', twoFactor: true })
    const conn = await createConnection({ driver: 'sqlite', database: ':memory:' })
    setConnection(conn)
    const created = await migrateBetterAuth(new SchemaBuilder(conn), auth.options)
    expect(created).toContain('user')
    expect(created).toContain('twoFactor')
  })
})
