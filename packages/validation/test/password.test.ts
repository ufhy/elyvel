import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Password } from '../src/password'
import { Validator } from '../src/validator'

async function errorsFor(password: unknown, rule: Password): Promise<string[]> {
  const bag = await Validator.make({ password }, { password: ['required', rule] }).errors()
  return bag.password ?? []
}

describe('Password', () => {
  test('min() — the default is 8 characters', async () => {
    expect(await errorsFor('short7x', Password.min(8))).toHaveLength(1)
    expect(await errorsFor('exactly8', Password.min(8))).toHaveLength(0)
  })

  test('letters() requires at least one letter', async () => {
    expect(await errorsFor('12345678', Password.min(8).letters())).toHaveLength(1)
    expect(await errorsFor('1234567a', Password.min(8).letters())).toHaveLength(0)
  })

  test('mixedCase() requires both an uppercase and a lowercase letter', async () => {
    expect(await errorsFor('alllower', Password.min(8).mixedCase())).toHaveLength(1)
    expect(await errorsFor('ALLUPPER', Password.min(8).mixedCase())).toHaveLength(1)
    expect(await errorsFor('MixedAaa', Password.min(8).mixedCase())).toHaveLength(0)
  })

  test('numbers() requires at least one digit', async () => {
    expect(await errorsFor('noDigitsX', Password.min(8).numbers())).toHaveLength(1)
    expect(await errorsFor('has1digit', Password.min(8).numbers())).toHaveLength(0)
  })

  test('symbols() requires at least one non-alphanumeric character', async () => {
    expect(await errorsFor('noSymbols1', Password.min(8).symbols())).toHaveLength(1)
    expect(await errorsFor('has-symbol1', Password.min(8).symbols())).toHaveLength(0)
  })

  test('chained constraints report every failing one at once', async () => {
    // Too short AND no number AND no symbol — three distinct failures.
    const errors = await errorsFor('abc', Password.min(8).numbers().symbols())
    expect(errors).toHaveLength(3)
  })

  test('doesn\'t enforce presence itself — empty values pass through (pair with required)', async () => {
    // Password ALONE (no `required` alongside it) shouldn't fail on emptiness.
    expect(await Validator.make({ password: '' }, { password: [Password.min(20)] }).errors())
      .toEqual({})
    expect(await Validator.make({}, { password: [Password.min(20)] }).errors())
      .toEqual({})
    // `required` on the SAME field still catches the absence — Password just doesn't double-report it.
    const bag = await Validator.make({}, { password: ['required', Password.min(8)] }).errors()
    expect(bag.password?.[0]).toContain('required')
  })

  test('default()/defaults() — app-wide configuration', async () => {
    Password.defaults(() => Password.min(10).numbers())
    expect(await errorsFor('short', Password.default())).toHaveLength(2) // too short AND no number
    expect(await errorsFor('longenough1', Password.default())).toHaveLength(0)
  })
})

describe('Password.uncompromised() (mocked HIBP API)', () => {
  const realFetch = globalThis.fetch

  beforeEach(() => {
    Password.defaults(() => Password.min(8)) // reset any prior default() config
  })
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  test('rejects a password whose hash suffix appears in the breach range response', async () => {
    // SHA-1("password123") = CBFDAC6008F9CAB4083784CBD1874F76618D2A97
    // prefix "CBFDA", suffix "C6008F9CAB4083784CBD1874F76618D2A97"
    globalThis.fetch = (async () =>
      new Response('C6008F9CAB4083784CBD1874F76618D2A97:5\nAAAA00000000000000000000000000000AA:1')) as unknown as typeof fetch

    expect(await errorsFor('password123', Password.min(8).uncompromised())).toHaveLength(1)
  })

  test('passes when the hash suffix isn\'t in the response', async () => {
    globalThis.fetch = (async () =>
      new Response('AAAA00000000000000000000000000000AA:1')) as unknown as typeof fetch

    expect(await errorsFor('password123', Password.min(8).uncompromised())).toHaveLength(0)
  })

  test('a threshold allows a small number of appearances', async () => {
    globalThis.fetch = (async () =>
      new Response('C6008F9CAB4083784CBD1874F76618D2A97:2')) as unknown as typeof fetch

    expect(await errorsFor('password123', Password.min(8).uncompromised(5))).toHaveLength(0)
    expect(await errorsFor('password123', Password.min(8).uncompromised(1))).toHaveLength(1)
  })

  test('fails OPEN when the API is unreachable — a network hiccup can\'t block registration', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch

    expect(await errorsFor('password123', Password.min(8).uncompromised())).toHaveLength(0)
  })

  test('fails open on a non-OK response too', async () => {
    globalThis.fetch = (async () => new Response('', { status: 500 })) as unknown as typeof fetch
    expect(await errorsFor('password123', Password.min(8).uncompromised())).toHaveLength(0)
  })
})
