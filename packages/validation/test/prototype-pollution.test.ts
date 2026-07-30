import { afterEach, describe, expect, test } from 'bun:test'
import { Validator } from '../src/validator'

/** Fail loudly if a probe ever leaves the prototype dirty for later tests. */
afterEach(() => {
  for (const key of ['name', 'polluted', 'isAdmin', 'x']) {
    delete (Object.prototype as Record<string, unknown>)[key]
  }
})

/**
 * Regression: `expandKey` expanded a `*` segment using `Object.keys()` of the
 * USER'S data, and `JSON.parse` creates an OWN `__proto__` key. So a request body
 * of `{"settings":{"__proto__":{"name":"x"}}}` under an ordinary wildcard rule
 * expanded to the path `settings.__proto__.name`, and `validated()`'s rebuild
 * walked into `Object.prototype` (assigning to `__proto__` sets the prototype
 * rather than creating a property) and wrote there — remote prototype pollution
 * from an unauthenticated request body, corrupting every object in the process.
 */
describe('a request body cannot pollute Object.prototype through validation', () => {
  test('a two-level wildcard rule does not write through the prototype', async () => {
    const body = JSON.parse('{"settings": {"__proto__": {"name": "pwned"}}}')

    const validator = new Validator(body, { 'settings.*.name': 'required' })
    await validator.passes()
    validator.validated()

    expect(({} as Record<string, unknown>).name).toBeUndefined()
    expect('name' in ({} as Record<string, unknown>)).toBe(false)
  })

  test('legitimate sibling keys still validate and survive into validated()', async () => {
    const body = JSON.parse(
      '{"settings": {"__proto__": {"name": "pwned"}, "theme": {"name": "dark"}}}',
    )

    const validator = new Validator(body, { 'settings.*.name': 'required' })
    expect(await validator.passes()).toBe(true)
    expect(validator.validated()).toEqual({ settings: { theme: { name: 'dark' } } })
    expect(({} as Record<string, unknown>).name).toBeUndefined()
  })

  test('a single-level wildcard is safe too', async () => {
    const body = JSON.parse('{"flags": {"__proto__": "pwned", "ok": "yes"}}')

    const validator = new Validator(body, { 'flags.*': 'required' })
    await validator.passes()
    expect(validator.validated()).toEqual({ flags: { ok: 'yes' } })
    expect(Object.getPrototypeOf({})).toBe(Object.prototype)
  })

  test('constructor and prototype keys are refused as well', async () => {
    const body = JSON.parse(
      '{"a": {"constructor": {"isAdmin": true}, "prototype": {"isAdmin": true}}}',
    )

    const validator = new Validator(body, { 'a.*.isAdmin': 'required' })
    await validator.passes()
    validator.validated()

    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined()
  })

  test('a rule that itself names an unsafe segment is refused loudly', async () => {
    const validator = new Validator({ __proto__: { x: 1 } } as never, { '__proto__.x': 'required' })
    await validator.passes()
    // A developer typo, not user input — fail loudly rather than write through.
    expect(() => validator.validated()).toThrow(/unsafe path/)
  })

  test('ordinary nested and array wildcard data is unaffected', async () => {
    const validator = new Validator(
      { tags: ['a', 'b'], user: { profile: { name: 'Ada' } } },
      { 'tags.*': 'required', 'user.profile.name': 'required' },
    )

    expect(await validator.passes()).toBe(true)
    expect(validator.validated()).toEqual({ tags: ['a', 'b'], user: { profile: { name: 'Ada' } } })
  })
})
