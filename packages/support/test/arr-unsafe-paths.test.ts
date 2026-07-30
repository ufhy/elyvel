import { afterEach, describe, expect, test } from 'bun:test'
import { Arr, isUnsafeKey } from '../src/arr'

afterEach(() => {
  for (const key of ['polluted', 'x']) delete (Object.prototype as Record<string, unknown>)[key]
})

/**
 * Regression: `Arr.set` walked the path creating intermediate objects, but
 * `target['__proto__']` is already an object — `Object.prototype` — so the walk
 * handed it over and the final assignment polluted every object in the process:
 *
 *   Arr.set({}, '__proto__.polluted', 'yes')  →  ({}).polluted === 'yes'
 *
 * Laravel's `Arr::set` has no equivalent hazard (PHP arrays have no prototype
 * chain), so the port inherited a vulnerability the original doesn't have.
 */
describe('Arr.set / Arr.forget refuse prototype-polluting paths', () => {
  test('__proto__ in a path throws instead of polluting', () => {
    expect(() => Arr.set({}, '__proto__.polluted', 'yes')).toThrow(/unsafe path segment/)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  test('an unsafe segment anywhere in the path is refused', () => {
    expect(() => Arr.set({}, 'a.__proto__.polluted', 'yes')).toThrow()
    expect(() => Arr.set({}, 'a.constructor.prototype.x', 1)).toThrow()
    expect(() => Arr.forget({ a: 1 }, '__proto__.polluted')).toThrow()
    expect(Object.getPrototypeOf({})).toBe(Object.prototype)
  })

  test('the prototype chain is intact and ordinary paths still work', () => {
    const target: Record<string, unknown> = {}
    Arr.set(target, 'a.b.c', 5)
    expect(target).toEqual({ a: { b: { c: 5 } } })
    expect(Arr.get<number>(target, 'a.b.c')).toBe(5)

    Arr.forget(target, 'a.b.c')
    expect(target).toEqual({ a: { b: {} } })
  })

  test('a key that merely CONTAINS an unsafe name is fine', () => {
    const target: Record<string, unknown> = {}
    Arr.set(target, 'my__proto__key.constructorName', 1)
    expect(Arr.get<number>(target, 'my__proto__key.constructorName')).toBe(1)
  })

  test('isUnsafeKey covers the three vectors and nothing else', () => {
    expect(isUnsafeKey('__proto__')).toBe(true)
    expect(isUnsafeKey('constructor')).toBe(true)
    expect(isUnsafeKey('prototype')).toBe(true)
    expect(isUnsafeKey('name')).toBe(false)
    expect(isUnsafeKey('proto')).toBe(false)
  })
})
