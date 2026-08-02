import { afterEach, describe, expect, test } from 'bun:test'
import { registerImplicitRule, registerRule, ruleNames } from '../src/rules'
import { Validator } from '../src/validator'

const added: string[] = []

function add(name: string, ...rest: Parameters<typeof registerRule> extends [string, ...infer R] ? R : never): void {
  added.push(name)
  registerRule(name, ...rest)
}

afterEach(() => {
  // Rules live in a module-level map; leaking one into another test file would
  // make failures depend on file order.
  for (const name of added.splice(0)) {
    delete (require('../src/rules') as { RULES: Record<string, unknown> }).RULES[name]
  }
})

/**
 * Laravel's `Validator::extend()`. Ours had no equivalent: `RULES` was exported
 * and mutable, so a package could reach in and assign — with no message
 * resolution, no name validation, and nothing to stop two libraries from
 * clobbering each other's rule.
 */
describe('registerRule', () => {
  test('a registered rule is usable by name, with arguments', async () => {
    add('phone', (value, args) => String(value).startsWith(args[0] ?? '+'))

    expect((await Validator.make({ p: '+6281' }, { p: 'phone:+62' }).fails())).toBe(false)
    expect((await Validator.make({ p: '0281' }, { p: 'phone:+62' }).fails())).toBe(true)
  })

  test('its message is used, and :attribute is substituted', async () => {
    add('phone', () => false, 'The :attribute must be a valid phone number.')

    const errors = await Validator.make({ mobile_number: 'x' }, { mobile_number: 'phone' }).errors()
    expect(errors.mobile_number?.[0]).toBe('The mobile number must be a valid phone number.')
  })

  test('without a message it still fails, with the generic fallback', async () => {
    add('weird', () => false)
    const errors = await Validator.make({ a: 1 }, { a: 'weird' }).errors()
    expect(errors.a?.[0]).toBeTruthy()
  })

  /**
   * A non-implicit rule never sees an absent value — that is what separates
   * `email` from `required`. Registering something that must reject absence
   * needs the implicit variant, as in Laravel.
   */
  test('an ordinary rule is skipped for a missing value; an implicit one is not', async () => {
    add('ordinary', () => false)
    expect((await Validator.make({}, { a: 'ordinary' }).fails())).toBe(false)

    added.push('demanding')
    registerImplicitRule('demanding', value => value !== undefined, 'The :attribute is demanded.')
    expect((await Validator.make({}, { a: 'demanding' }).fails())).toBe(true)
  })

  test('an async rule is awaited', async () => {
    add('slow', async value => Promise.resolve(value === 'ok'))
    expect((await Validator.make({ a: 'ok' }, { a: 'slow' }).fails())).toBe(false)
    expect((await Validator.make({ a: 'no' }, { a: 'slow' }).fails())).toBe(true)
  })

  test('the name is listed alongside the built-ins', () => {
    add('phone', () => true)
    expect(ruleNames()).toContain('phone')
    expect(ruleNames()).toContain('required')
  })

  /**
   * `RULES` is a plain object, so a rule named `__proto__` would write through
   * its prototype — the same hole already found and fixed in the wildcard rule
   * and in model attribute filling.
   */
  test('a prototype-polluting name is rejected', () => {
    expect(() => registerRule('__proto__', () => true)).toThrow(TypeError)
    expect(() => registerRule('constructor', () => true)).toThrow(TypeError)
  })

  test('a name with spaces or a colon is rejected — it would never parse back', () => {
    expect(() => registerRule('my rule', () => true)).toThrow(/alphanumeric/)
    expect(() => registerRule('min:5', () => true)).toThrow(/alphanumeric/)
  })
})
