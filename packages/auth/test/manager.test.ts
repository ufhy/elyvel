import { rateLimiter } from '@elyvel/core'
import { beforeEach, describe, expect, test } from 'bun:test'
import { TooManyAttemptsError } from '../src/manager'
import { makeMemoryAuth } from './fixtures/memory-auth'

// attempt()'s lockout is keyed by email on a process-wide RateLimiter — reset
// between tests so one test's failed attempts don't count toward another's.
beforeEach(() => rateLimiter.clear())

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

describe('AuthManager — brute-force lockout', () => {
  test('locks out after maxAttempts failed attempts, throwing TooManyAttemptsError', async () => {
    const { auth } = await makeMemoryAuth({ maxAttempts: 3, decayMinutes: 1 })
    for (let i = 0; i < 3; i++) {
      expect(await auth.attempt({ email: 'ada@example.com', password: 'wrong' })).toBeNull()
    }
    // The 4th attempt — even with the CORRECT password — is locked out.
    await expect(auth.attempt({ email: 'ada@example.com', password: 'secret' }))
      .rejects
      .toThrow(TooManyAttemptsError)
  })

  test('a locked-out email doesn\'t affect a different email', async () => {
    const { auth } = await makeMemoryAuth({ maxAttempts: 1, decayMinutes: 1 })
    expect(await auth.attempt({ email: 'ada@example.com', password: 'wrong' })).toBeNull()
    await expect(auth.attempt({ email: 'ada@example.com', password: 'secret' }))
      .rejects
      .toThrow(TooManyAttemptsError)
    // A different email is unaffected — it has its own counter.
    expect(await auth.attempt({ email: 'ghost@example.com', password: 'anything' })).toBeNull()
  })

  test('a successful login resets the failed-attempt counter', async () => {
    const { auth } = await makeMemoryAuth({ maxAttempts: 3, decayMinutes: 1 })
    await auth.attempt({ email: 'ada@example.com', password: 'wrong' })
    await auth.attempt({ email: 'ada@example.com', password: 'wrong' })
    const success = await auth.attempt({ email: 'ada@example.com', password: 'secret' })
    expect(success).not.toBeNull()

    // Counter reset by the success — 2 more wrong attempts shouldn't lock out yet.
    await auth.attempt({ email: 'ada@example.com', password: 'wrong' })
    await auth.attempt({ email: 'ada@example.com', password: 'wrong' })
    expect(await auth.attempt({ email: 'ada@example.com', password: 'secret' })).not.toBeNull()
  })
})
