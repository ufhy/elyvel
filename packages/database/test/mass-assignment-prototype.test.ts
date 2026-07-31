import { describe, expect, test } from 'bun:test'
import { Model } from '../src/model'

/** A request body as `JSON.parse` builds it: `__proto__` is an OWN property. */
function hostileBody(): Record<string, unknown> {
  return JSON.parse('{"__proto__":{"isAdmin":true,"role":"admin"},"name":"ok"}') as Record<string, unknown>
}

class Unguarded extends Model {
  static override table = 'things'
  static override guarded: string[] = []
  static override timestamps = false
}

/**
 * Regression: `setAttribute` did `this.attributes[key] = value`, and assigning to
 * `__proto__` REPLACES that object's prototype rather than adding a column. On an
 * unguarded model — `static guarded = []`, a common and documented convention — a
 * body of `{"__proto__":{"isAdmin":true}}` therefore made
 * `getAttribute('isAdmin')` and `model.isAdmin` return true.
 *
 * It was invisible: `Object.keys` and `toJSON` only see own properties, so the
 * injected value never appeared in a response or a log. Only reads were affected —
 * which is exactly what an authorization check does.
 */
describe('a prototype-manipulating key cannot be mass-assigned', () => {
  test('the attributes prototype is left alone', () => {
    const model = new Unguarded()
    model.fill(hostileBody())

    const attributes = (model as unknown as { attributes: object }).attributes
    expect(Object.getPrototypeOf(attributes)).toBe(Object.prototype)
  })

  test('the injected attribute does not become readable', () => {
    const model = new Unguarded()
    model.fill(hostileBody())

    expect(model.getAttribute('isAdmin')).toBeUndefined()
    expect(model.getAttribute('role')).toBeUndefined()
    expect((model as unknown as Record<string, unknown>).isAdmin).toBeUndefined()
  })

  test('legitimate columns in the same body still fill', () => {
    const model = new Unguarded()
    model.fill(hostileBody())
    expect(model.getAttribute('name')).toBe('ok')
  })

  test('Object.prototype itself is never touched', () => {
    const model = new Unguarded()
    model.fill(hostileBody())
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined()
  })

  test('constructor and prototype keys are refused too', () => {
    const model = new Unguarded()
    model.fill(JSON.parse('{"constructor":{"x":1},"prototype":{"y":2},"name":"ok"}') as Record<string, unknown>)
    expect(model.getAttribute('name')).toBe('ok')
    expect(Object.getPrototypeOf((model as unknown as { attributes: object }).attributes)).toBe(Object.prototype)
  })

  /**
   * Mass assignment SKIPS the key (untrusted input must not be a trivial 500),
   * but code calling `setAttribute` directly gets told, since that's a bug.
   */
  test('setAttribute called directly throws', () => {
    const model = new Unguarded()
    expect(() => model.setAttribute('__proto__', { isAdmin: true })).toThrow(/prototype chain/)
    expect(() => model.setAttribute('constructor', {})).toThrow()
  })

  test('a guarded model was already safe and stays safe', () => {
    class Guarded extends Model {
      static override table = 'things'
      static override fillable = ['name']
      static override timestamps = false
    }
    const model = new Guarded()
    model.fill(hostileBody())
    expect(model.getAttribute('isAdmin')).toBeUndefined()
    expect(model.getAttribute('name')).toBe('ok')
  })
})
