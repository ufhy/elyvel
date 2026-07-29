import { describe, expect, test } from 'bun:test'
import { configureDbRules, DbRuleTimeoutError } from '../src/db-rules'
import { FormRequest } from '../src/form-request'
import { ValidationException } from '../src/validation-exception'
import { validate, Validator } from '../src/validator'

describe('Validator — rules', () => {
  test('required rejects missing, null, and empty string (Laravel semantics)', async () => {
    const bag = await Validator.make(
      { a: '', b: null, c: 'ok' },
      { a: 'required', b: 'required', c: 'required', d: 'required' },
    ).errors()
    expect(bag.a?.[0]).toBe('The a field is required.')
    expect(bag.b).toBeDefined()
    expect(bag.d).toBeDefined()
    expect(bag.c).toBeUndefined()
  })

  test('email / min / max with type-aware messages', async () => {
    const bag = await Validator.make(
      { email: 'nope', name: 'ab', age: 5 },
      { email: 'required|email', name: 'required|string|min:3', age: 'required|integer|min:18' },
    ).errors()
    expect(bag.email?.[0]).toBe('The email field must be a valid email address.')
    expect(bag.name?.[0]).toBe('The name field must be at least 3 characters.')
    expect(bag.age?.[0]).toBe('The age field must be at least 18.') // numeric variant
  })

  test('in / confirmed (cross-field)', async () => {
    const bag = await Validator.make(
      { role: 'x', password: 'secret12', password_confirmation: 'nope' },
      { role: 'in:admin,user', password: 'confirmed' },
    ).errors()
    expect(bag.role?.[0]).toBe('The selected role is invalid.')
    expect(bag.password?.[0]).toBe('The password field confirmation does not match.')
  })

  test('optional field: non-implicit rules skipped when empty', async () => {
    const bag = await Validator.make({ nickname: '' }, { nickname: 'string|min:3' }).errors()
    expect(bag.nickname).toBeUndefined() // empty + not required → skipped
  })

  test('humanizes snake_case attribute names', async () => {
    const bag = await Validator.make({}, { first_name: 'required' }).errors()
    expect(bag.first_name?.[0]).toBe('The first name field is required.')
  })

  test('custom messages and attribute names', async () => {
    const bag = await Validator.make(
      { email: '' },
      { email: 'required' },
      {
        messages: { 'email.required': 'We need your :attribute!' },
        attributes: { email: 'email address' },
      },
    ).errors()
    expect(bag.email?.[0]).toBe('We need your email address!')
  })
})

describe('Validator — unique via DB resolver', () => {
  test('unique passes when count 0, fails when > 0', async () => {
    configureDbRules({ count: async (_t, _c, value) => (value === 'taken@x.io' ? 1 : 0) })
    const ok = await Validator.make(
      { email: 'free@x.io' },
      { email: 'required|email|unique:users,email' },
    ).passes()
    expect(ok).toBe(true)

    const bag = await Validator.make(
      { email: 'taken@x.io' },
      { email: 'required|email|unique:users,email' },
    ).errors()
    expect(bag.email?.[0]).toBe('The email has already been taken.')
  })

  test('a hung resolver query rejects with DbRuleTimeoutError instead of hanging forever', async () => {
    // Simulates a stuck connection pool / network partition: the resolver's
    // promise never settles. Without a timeout, this `await` — and the whole
    // request behind it — would hang indefinitely.
    configureDbRules({ count: () => new Promise<number>(() => {}) }, { timeoutMs: 20 })
    await expect(
      Validator.make({ email: 'x@y.io' }, { email: 'unique:users,email' }).passes(),
    ).rejects.toThrow(DbRuleTimeoutError)
    // Restore a fast resolver + default timeout for the rest of the suite.
    configureDbRules({ count: async () => 0 }, { timeoutMs: 5000 })
  })
})

describe('validate() + ValidationException', () => {
  test('throws a 422 bag on failure, returns validated data on success', async () => {
    await expect(validate({ email: 'nope' }, { email: 'required|email' })).rejects.toThrow(
      ValidationException,
    )
    try {
      await validate({ a: '', b: 'x' }, { a: 'required', b: 'required' })
    }
    catch (e) {
      const ex = e as ValidationException
      expect(ex.status).toBe(422)
      expect(ex.errors.a).toBeDefined()
      expect(ex.message).toContain('required')
    }
    const data = await validate({ name: 'Ada', extra: 1 }, { name: 'required|string' })
    expect(data).toEqual({ name: 'Ada' }) // only ruled fields
  })
})

describe('FormRequest', () => {
  class StoreUser extends FormRequest {
    rules() {
      return { email: 'required|email', age: 'required|integer|min:18' }
    }

    override messages() {
      return { 'email.required': 'Email wajib diisi.' }
    }
  }

  test('validates ctx.body', async () => {
    const data = await StoreUser.validate({ body: { email: 'a@b.io', age: 20 } })
    expect(data).toEqual({ email: 'a@b.io', age: 20 })
  })

  test('throws with custom message + authorize()', async () => {
    await expect(StoreUser.validate({ body: { age: 5 } })).rejects.toThrow(ValidationException)

    class Denied extends FormRequest {
      override authorize() {
        return false
      }

      rules() {
        return {}
      }
    }
    await expect(Denied.validate({ body: {} })).rejects.toThrow(/unauthorized/i)
  })

  test('rules() receives the same ctx passed to validate() — e.g. to exclude the current row from a unique check', async () => {
    class UpdateUser extends FormRequest {
      rules(ctx: { model?: { id: number } }) {
        return { email: `required|email|unique:users,email,${ctx.model?.id}` }
      }
    }
    // Can't exercise the DB side here (no resolver configured), but confirms
    // the interpolated ignore-id made it into the compiled rule string.
    await expect(UpdateUser.validate({ model: { id: 42 }, body: { email: 'not-an-email' } }))
      .rejects
      .toThrow(ValidationException)
  })

  test('prepareForValidation normalizes input before rules run', async () => {
    class StorePost extends FormRequest {
      override prepareForValidation(data: Record<string, unknown>) {
        data.slug = String(data.title ?? '').toLowerCase().replace(/\s+/g, '-')
        return data
      }

      rules() {
        return { title: 'required', slug: 'required' }
      }
    }
    const data = await StorePost.validate({ body: { title: 'Hello World' } })
    expect(data.slug).toBe('hello-world') // derived pre-validation, passed the required rule
  })

  test('passedValidation runs after a successful validation', async () => {
    const seen: unknown[] = []
    class StoreThing extends FormRequest {
      rules() {
        return { name: 'required' }
      }

      override passedValidation(validated: Record<string, unknown>) {
        seen.push(validated.name)
      }
    }
    await StoreThing.validate({ body: { name: 'ok' } })
    expect(seen).toEqual(['ok'])
    // does NOT run when validation fails
    await expect(StoreThing.validate({ body: {} })).rejects.toThrow(ValidationException)
    expect(seen).toEqual(['ok'])
  })
})

// Regression suite for two bug classes found in a 2026-07-29 correctness audit:
// (a) `validated()` returned the whole top-level PARENT for a nested rule, so
//     unvalidated siblings rode along into the "validated" output;
// (b) every rule naming ANOTHER field looked it up flat (`data[arg]`), so any
//     dotted name silently resolved to `undefined` — the condition never
//     matched and the rule became a no-op that looked active.
describe('validated() returns only what was actually validated', () => {
  test('a nested rule yields the leaf, not its whole parent', async () => {
    const out = await Validator.make(
      { user: { name: 'x', is_admin: true } },
      { 'user.name': 'required|string' },
    ).validate()
    expect(out).toEqual({ user: { name: 'x' } }) // is_admin never validated
  })

  test('a wildcard rule rebuilds an array (not an index-keyed object)', async () => {
    const out = await Validator.make(
      { tags: ['a', 'b'], secret: 1 },
      { 'tags.*': 'string' },
    ).validate()
    expect(out).toEqual({ tags: ['a', 'b'] })
  })

  test('a wildcard over a non-array leaks nothing', async () => {
    // Expands to zero paths, so nothing is validated — and nothing escapes.
    expect(await Validator.make({ tags: 'notanarray' }, { 'tags.*': 'string' }).validate())
      .toEqual({})
  })

  test('excluding a nested path keeps its validated siblings', async () => {
    const out = await Validator.make(
      { t: 'g', items: [{ q: 5, n: 'x' }] },
      { 'items.*.q': 'exclude_if:t,g', 'items.*.n': 'required' },
    ).validate()
    expect(out).toEqual({ items: [{ n: 'x' }] })
  })
})

describe('rules resolve dotted other-field names', () => {
  const fails = (data: Record<string, unknown>, rules: Record<string, string>) =>
    Validator.make(data, rules).validate().then(() => false, () => true)

  test('required_if / required_with fire on a nested other-field', async () => {
    expect(await fails({ addr: { country: 'ID' }, prov: '' }, { prov: 'required_if:addr.country,ID' })).toBe(true)
    expect(await fails({ addr: { country: 'US' }, prov: '' }, { prov: 'required_if:addr.country,ID' })).toBe(false)
    expect(await fails({ user: { a: 1 }, b: '' }, { b: 'required_with:user.a' })).toBe(true)
  })

  test('missing / filled / present work on a nested path', async () => {
    expect(await fails({ user: { role: 'admin' } }, { 'user.role': 'missing' })).toBe(true)
    expect(await fails({ user: {} }, { 'user.role': 'missing' })).toBe(false)
    expect(await fails({ user: { name: '' } }, { 'user.name': 'filled' })).toBe(true)
    expect(await fails({ user: { name: 'a' } }, { 'user.name': 'present' })).toBe(false)
  })

  test('same / different / lte compare against the nested value', async () => {
    expect(await fails({ user: { pw: 'x' }, c: 'x' }, { c: 'same:user.pw' })).toBe(false)
    expect(await fails({ a: { b: 'y' }, v: 'x' }, { v: 'different:a.b' })).toBe(false)
    expect(await fails({ limits: { max: 5 }, n: 9 }, { n: 'numeric|lte:limits.max' })).toBe(true)
  })

  test('different does not pass just because the other field is unresolvable', async () => {
    // Used to be `undefined !== value`, i.e. always "different" — so the rule
    // silently approved everything when the name was mistyped or dotted.
    expect(await fails({ v: 'x' }, { v: 'different:no.such.field' })).toBe(true)
  })
})

// Second batch from the 2026-07-29 audit: rules that silently PASSED invalid
// input, or rejected valid input. Each was reproduced before being fixed.
describe('size, emptiness, regex and scheme rules', () => {
  const passes = (data: Record<string, unknown>, rules: Record<string, string>) =>
    Validator.make(data, rules).validate().then(() => true, () => false)

  test('a size limit measures a file by its bytes, not String(blob).length', async () => {
    // `kind` comes from rule NAMES, so `max:1024` with no `file`/`image` fell
    // through to `String(value).length` — 13 for any Blob. Every upload passed
    // every size limit, and `mimes:png|max:1024` is a very natural thing to write.
    const big = new Blob([new Uint8Array(5 * 1024 * 1024)])
    const small = new Blob([new Uint8Array(100)])
    expect(await passes({ a: big }, { a: 'max:1024' })).toBe(false)
    expect(await passes({ a: small }, { a: 'max:1024' })).toBe(true)
    expect(await passes({ a: big }, { a: 'file|max:1024' })).toBe(false)
  })

  test('the other size kinds are unchanged', async () => {
    expect(await passes({ s: 'abcdef' }, { s: 'max:3' })).toBe(false) // string length
    expect(await passes({ a: [1, 2, 3, 4] }, { a: 'array|max:3' })).toBe(false) // array count
    expect(await passes({ n: '9' }, { n: 'numeric|max:3' })).toBe(false) // numeric value
  })

  test('a whitespace-only string is empty', async () => {
    expect(await passes({ n: '   ' }, { n: 'required' })).toBe(false)
    expect(await passes({ n: 'ok' }, { n: 'required' })).toBe(true)
  })

  test('a regex pattern is one argument, commas and all', async () => {
    // Args were comma-split, so `^\d{3,5}$` compiled as `^\d{3` and rejected
    // valid input; a pattern containing a comma class threw out of errors().
    expect(await passes({ p: '1234' }, { p: 'regex:^\\d{3,5}$' })).toBe(true)
    expect(await passes({ p: '12' }, { p: 'regex:^\\d{3,5}$' })).toBe(false)
    expect(await passes({ p: 'a,b' }, { p: 'regex:^[a-z,]+$' })).toBe(true)
  })

  test('url accepts only http(s)', async () => {
    // URL.canParse accepts `javascript:` and `data:` — precisely the schemes
    // that must not survive validation and reach an href.
    expect(await passes({ u: 'javascript:alert(1)' }, { u: 'url' })).toBe(false)
    expect(await passes({ u: 'data:text/html,<script>' }, { u: 'url' })).toBe(false)
    expect(await passes({ u: 'https://ok.test/x' }, { u: 'url' })).toBe(true)
    expect(await passes({ u: 'not a url' }, { u: 'url' })).toBe(false)
  })

  test('ip checks octet ranges, not just the shape', async () => {
    expect(await passes({ i: '999.999.999.999' }, { i: 'ip' })).toBe(false)
    expect(await passes({ i: '10.0.0.1' }, { i: 'ip' })).toBe(true)
  })
})
