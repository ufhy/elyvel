import { currentActorId, requestContext } from '@elyvel/core'
import { createConnection, Model, SchemaBuilder, setConnection } from '@elyvel/database'
import { Password } from '@elyvel/validation'
import { betterAuth } from 'better-auth'
import { beforeEach, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { composeBefore } from '../src/auth-hooks'
import { AuthActions } from '../src/auth-requests'
import { betterAuthPlugin } from '../src/better-auth'
import { migrateBetterAuth } from '../src/better-auth-schema'
import { eloquentAdapter } from '../src/eloquent-adapter'

// The full real chain userstamps depends on: requestContext()'s onRequest opens
// an empty actor scope synchronously, betterAuthPlugin's async user-derive
// fills it in after resolving the session (an internal await — exactly the
// case that breaks a naive `enterWith()`, see core's actor.ts), and by the
// time the route handler's Model.save() runs, currentActorId() must already
// be the signed-in user's real id.
class Post extends Model {
  static override guarded = []
  static override table = 'posts'
  static override userstamps = true
  declare id: number
  declare title: string
}

const auth = betterAuth({
  database: eloquentAdapter(),
  emailAndPassword: { enabled: true },
  secret: 'test-secret-please-change-please',
  baseURL: 'http://localhost',
  hooks: { before: composeBefore() },
})

const app: any = new Elysia()
  .use(requestContext())
  .use(betterAuthPlugin({ instance: auth }))
  .post('/posts', async ({ body }: any) => (await Post.create({ title: (body as any).title })).toObject(), { auth: true })
  .get('/whoami', () => ({ actor: currentActorId() }))

// Reset process-global auth defaults — another test file booting an app (e.g.
// better-auth.test.ts or an example) may have set a stricter Password.defaults()
// in this shared process, which would otherwise fail our sign-up silently.
beforeEach(async () => {
  Password.reset()
  AuthActions.reset()
  const conn = await createConnection({ driver: 'sqlite', database: ':memory:' })
  setConnection(conn)
  await migrateBetterAuth(new SchemaBuilder(conn), auth.options)
  await new SchemaBuilder(conn).create('posts', (t) => {
    t.id()
    t.string('title')
    t.timestamps()
    // This test uses raw `betterAuth()` (like better-auth.test.ts), which
    // keeps Better Auth's default singular table name `user` — only
    // `defineAuth()` remaps it to plural `users`.
    t.userstamps('user')
  })
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

describe('userstamps, end to end through a real signed-in request', () => {
  test('a Post created in an authenticated route gets created_by/updated_by from the session user', async () => {
    const signUpRes = await signUp('ada@x.test')
    const cookie = (signUpRes.headers.get('set-cookie') ?? '').split(';')[0]
    const userId = ((await signUpRes.json()) as any).user.id

    const res = await app.handle(
      new Request('http://localhost/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ title: 'Hello' }),
      }),
    )
    const post = (await res.json()) as any
    expect(post.created_by).toBe(userId)
    expect(post.updated_by).toBe(userId)
  })

  test('an unauthenticated request never reaches the handler (auth: true guards it) — no actor leakage either', async () => {
    const res = await app.handle(new Request('http://localhost/whoami'))
    expect((await res.json()).actor).toBeUndefined()
  })
})
