import { describe, expect, test } from 'bun:test'
import { configureDbRules } from '../src/db-rules'
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
})
