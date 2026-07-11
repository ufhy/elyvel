import { describe, expect, test } from 'bun:test'
import { Hash } from '../src/hash'
import { generateToken, hashToken } from '../src/token'

describe('Hash', () => {
  test('verifies a value against its hash', async () => {
    const hashed = await Hash.make('super-secret')
    expect(await Hash.verify('super-secret', hashed)).toBe(true)
    expect(await Hash.verify('wrong', hashed)).toBe(false)
  })

  test('produces a distinct hash each time (salted)', async () => {
    expect(await Hash.make('x')).not.toBe(await Hash.make('x'))
  })
})

describe('token utils', () => {
  test('generateToken yields unique high-entropy tokens', () => {
    const a = generateToken()
    const b = generateToken()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThan(32)
  })

  test('hashToken is deterministic sha-256 hex', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'))
    expect(hashToken('abc')).toMatch(/^[a-f0-9]{64}$/)
  })
})
