import { createConnection, SchemaBuilder, setConnection, table } from '@elyvel/database'
import { beforeEach, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { betterAuthPlugin } from '../src/better-auth'
import { migrateBetterAuth } from '../src/better-auth-schema'
import { defineAuth } from '../src/define-auth'

// Registration closed via the features map — the HTTP route must 404, but the
// programmatic API must still work (admin/invite-only user creation).
const auth = defineAuth({
  secret: 'test-secret-please-change-please',
  baseURL: 'http://localhost',
  features: { registration: false },
})
const app: any = new Elysia().use(betterAuthPlugin({ instance: auth }))

beforeEach(async () => {
  const conn = await createConnection({ driver: 'sqlite', database: ':memory:' })
  setConnection(conn)
  await migrateBetterAuth(new SchemaBuilder(conn), auth.options)
})

test('features.registration:false → POST /sign-up/email is a real 404', async () => {
  const res = await app.handle(
    new Request('http://localhost/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ada', email: 'ada@x.test', password: 'password123' }),
    }),
  )
  expect(res.status).toBe(404)
  // Nothing created — the endpoint is gone, not merely refused.
  expect(await table('users').where('email', 'ada@x.test').first()).toBeUndefined()
})

test('programmatic auth.api.signUpEmail still works when the route is closed', async () => {
  const out = await auth.api.signUpEmail({
    body: { name: 'Ada', email: 'admin-made@x.test', password: 'password123' },
  })
  expect(out?.user?.email).toBe('admin-made@x.test')
  expect(await table('users').where('email', 'admin-made@x.test').first()).toBeDefined()
})

test('other routes stay open when only registration is disabled', async () => {
  // A closed feature is surgical: sign-in still reaches its handler (401/4xx,
  // not 404) for a non-existent user.
  const res = await app.handle(
    new Request('http://localhost/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@x.test', password: 'password123' }),
    }),
  )
  expect(res.status).not.toBe(404)
})
