import { describe, expect, test } from 'bun:test'
import { makeMemoryAuth } from './fixtures/memory-auth'

describe('AuthManager', () => {
  test('attempt issues a token for valid credentials', async () => {
    const { auth } = await makeMemoryAuth()
    const result = await auth.attempt({ email: 'ada@example.com', password: 'secret' })
    expect(result).not.toBeNull()
    expect(result?.user.id).toBe(1)
    expect(typeof result?.token).toBe('string')
    expect(result?.token.length).toBeGreaterThan(20)
  })

  test('attempt rejects a wrong password', async () => {
    const { auth } = await makeMemoryAuth()
    expect(await auth.attempt({ email: 'ada@example.com', password: 'nope' })).toBeNull()
  })

  test('attempt rejects an unknown email', async () => {
    const { auth } = await makeMemoryAuth()
    expect(await auth.attempt({ email: 'ghost@example.com', password: 'secret' })).toBeNull()
  })

  test('user() resolves the authenticated user from a token', async () => {
    const { auth } = await makeMemoryAuth()
    const { token } = (await auth.attempt({ email: 'ada@example.com', password: 'secret' }))!
    const user = await auth.user(token)
    expect(user?.email).toBe('ada@example.com')
  })

  test('user() returns null for an invalid token', async () => {
    const { auth } = await makeMemoryAuth()
    expect(await auth.user('not-a-real-token')).toBeNull()
  })

  test('logout revokes the token', async () => {
    const { auth } = await makeMemoryAuth()
    const { token } = (await auth.attempt({ email: 'ada@example.com', password: 'secret' }))!
    await auth.logout(token)
    expect(await auth.user(token)).toBeNull()
  })

  test('tokens are stored hashed, never in plaintext', async () => {
    const { auth, tokens } = await makeMemoryAuth()
    const { token } = (await auth.attempt({ email: 'ada@example.com', password: 'secret' }))!
    expect(tokens.has(token)).toBe(false) // stored key is the hash, not the plaintext
    expect([...tokens.keys()][0]).toMatch(/^[a-f0-9]{64}$/)
  })
})
