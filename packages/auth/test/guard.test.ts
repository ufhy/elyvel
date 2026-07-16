import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { makeMemoryAuth } from './fixtures/memory-auth'

interface Handler { handle(request: Request): Promise<Response> }

async function buildApp() {
  const { auth } = await makeMemoryAuth()
  const app = new Elysia()
    .use(auth.guard())
    .get('/public', ({ user }) => ({ authed: user !== null }))
    .get('/private', ({ user }) => ({ id: user?.id }), { auth: true })
  const { token } = (await auth.attempt({ email: 'ada@example.com', password: 'secret' }))!
  return { app, token }
}

function get(app: Handler, path: string, token?: string) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  )
}

describe('auth guard', () => {
  test('protected route returns 401 without a token', async () => {
    const { app } = await buildApp()
    const res = await get(app, '/private')
    expect(res.status).toBe(401)
  })

  test('protected route returns 200 with a valid token', async () => {
    const { app, token } = await buildApp()
    const res = await get(app, '/private', token)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 1 })
  })

  test('public route resolves user when a token is present', async () => {
    const { app, token } = await buildApp()
    expect(await (await get(app, '/public')).json()).toEqual({ authed: false })
    expect(await (await get(app, '/public', token)).json()).toEqual({ authed: true })
  })

  test('an invalid token is treated as unauthenticated', async () => {
    const { app } = await buildApp()
    const res = await get(app, '/private', 'garbage')
    expect(res.status).toBe(401)
  })
})
