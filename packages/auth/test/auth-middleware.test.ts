import { ConfigRepository, setConfigRepository } from '@elyvel/core'
import { afterEach, describe, expect, test } from 'bun:test'
import { AuthGuard, VerifiedGuard } from '../src/auth-middleware'

/** Minimal middleware context stand-in. */
function ctx(user: unknown, accept?: string) {
  return {
    user,
    request: new Request('http://x/protected', accept ? { headers: { accept } } : {}),
    status: (code: number, body?: unknown) => ({ __status: code, body }),
  } as any
}

afterEach(() => setConfigRepository(null))

describe('authGuard', () => {
  test('browser guest redirects to the configured login path', () => {
    setConfigRepository(new ConfigRepository({ auth: { loginPath: '/signin' } }))
    const res = new AuthGuard().handle(ctx(null)) as Response
    expect(res).toBeInstanceOf(Response)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/signin')
  })

  test('defaults to /login when not configured', () => {
    setConfigRepository(new ConfigRepository({}))
    const res = new AuthGuard().handle(ctx(null)) as Response
    expect(res.headers.get('location')).toBe('/login')
  })

  test('JSON client gets 401, not a redirect', () => {
    setConfigRepository(new ConfigRepository({}))
    const res = new AuthGuard().handle(ctx(null, 'application/json')) as { __status: number }
    expect(res.__status).toBe(401)
  })

  test('an authenticated user passes through', () => {
    setConfigRepository(new ConfigRepository({}))
    expect(new AuthGuard().handle(ctx({ id: '1' }))).toBeUndefined()
  })
})

describe('verifiedGuard', () => {
  test('unverified browser user redirects to the configured verify path', () => {
    setConfigRepository(new ConfigRepository({ auth: { verifyPath: '/confirm' } }))
    const res = new VerifiedGuard().handle(ctx({ id: '1', emailVerified: false })) as Response
    expect(res.headers.get('location')).toBe('/confirm')
  })

  test('a verified user passes through', () => {
    setConfigRepository(new ConfigRepository({}))
    expect(new VerifiedGuard().handle(ctx({ id: '1', emailVerified: true }))).toBeUndefined()
  })
})
