import { describe, expect, test } from 'bun:test'
import { Validator } from '../src/validator'

describe('nested / wildcard / distinct', () => {
  test('dot + wildcard paths, errors keyed by concrete path', async () => {
    const bag = await Validator.make(
      { user: { email: 'nope' }, tags: ['ok', ''] },
      { 'user.email': 'required|email', 'tags.*': 'required|string' },
    ).errors()
    expect(bag['user.email']?.[0]).toBe('The user.email field must be a valid email address.')
    expect(bag['tags.1']).toBeDefined() // empty element fails required
    expect(bag['tags.0']).toBeUndefined()
  })

  test('validates each array element', async () => {
    const bag = await Validator.make(
      { users: [{ email: 'a@b.io' }, { email: 'bad' }] },
      { 'users.*.email': 'required|email' },
    ).errors()
    expect(bag['users.1.email']).toBeDefined()
    expect(bag['users.0.email']).toBeUndefined()
  })

  test('distinct flags duplicates', async () => {
    const bag = await Validator.make({ ids: [1, 2, 2] }, { 'ids.*': 'distinct' }).errors()
    expect(bag['ids.1']).toBeDefined()
    expect(bag['ids.2']).toBeDefined()
    expect(bag['ids.0']).toBeUndefined()
  })

  test('array:keys restricts allowed keys', async () => {
    const bag = await Validator.make({ opts: { a: 1, z: 9 } }, { opts: 'array:a,b' }).errors()
    expect(bag.opts).toBeDefined() // z not allowed
  })
})

describe('custom rules', () => {
  test('closure rule', async () => {
    const bag = await Validator.make(
      { name: 'foo' },
      {
        name: [
          'required',
          (value, fail) => {
            if (value === 'foo') fail('The :attribute is reserved.')
          },
        ],
      },
    ).errors()
    expect(bag.name?.[0]).toBe('The :attribute is reserved.')
  })

  test('rule object', async () => {
    const uppercase = {
      validate(value: unknown, fail: (m: string) => void) {
        if (String(value) !== String(value).toUpperCase()) fail('Must be uppercase.')
      },
    }
    expect(await Validator.make({ code: 'abc' }, { code: [uppercase] }).passes()).toBe(false)
    expect(await Validator.make({ code: 'ABC' }, { code: [uppercase] }).passes()).toBe(true)
  })
})

describe('flow: bail / exclude / sometimes / after / safe', () => {
  test('bail stops at first failure', async () => {
    const bag = await Validator.make({ pw: 'x' }, { pw: 'bail|min:8|regex:^[0-9]+$' }).errors()
    expect(bag.pw).toHaveLength(1) // only the first failure
  })

  test('exclude_if removes field', async () => {
    const v = Validator.make(
      { type: 'guest', email: 'bad' },
      { email: 'exclude_if:type,guest|required|email' },
    )
    expect(await v.passes()).toBe(true)
    expect(await v.validated()).toEqual({}) // email excluded
  })

  test('sometimes() conditional rules', async () => {
    const v = Validator.make({ pay: 'card' }, { pay: 'required' }).sometimes(
      'card_number',
      { card_number: 'required' },
      (d) => d.pay === 'card',
    )
    const bag = await v.errors()
    expect(bag.card_number).toBeDefined()
  })

  test('after() hook + safe().only/except', async () => {
    const v = Validator.make({ a: 1, b: 2 }, { a: 'required', b: 'required' })
    v.after(({ add }) => add('a', 'extra error'))
    const bag = await v.errors()
    expect(bag.a).toContain('extra error')

    const ok = Validator.make({ a: 1, b: 2, c: 3 }, { a: 'required', b: 'required' })
    await ok.passes()
    expect(ok.safe().only(['a'])).toEqual({ a: 1 })
    expect(ok.safe().except(['a'])).toEqual({ b: 2 })
  })
})

describe('new rules batch', () => {
  test('conditional + comparison + string/number', async () => {
    expect(await Validator.make({ a: 'x', b: '' }, { b: 'required_unless:a,y' }).fails()).toBe(true) // a!==y → b required
    expect(
      await Validator.make(
        { start: '2020-01-01', end: '2019-01-01' },
        {
          end: 'after_or_equal:start',
        },
      ).fails(),
    ).toBe(true)
    expect(await Validator.make({ d: '2020-13-01' }, { d: 'date_format:Y-m-d' }).fails()).toBe(
      false,
    ) // matches Y-m-d shape (format check, not calendar)
    expect(await Validator.make({ n: '1.239' }, { n: 'decimal:2' }).fails()).toBe(true)
    expect(await Validator.make({ n: 9 }, { n: 'multiple_of:3' }).passes()).toBe(true)
    expect(await Validator.make({ s: 'AbC' }, { s: 'uppercase' }).fails()).toBe(true)
    expect(
      await Validator.make({ role: 'x', roles: ['a', 'b'] }, { role: 'in_array:roles' }).fails(),
    ).toBe(true)
  })

  test('file rules (file/image/mimes/size)', async () => {
    const png = new File(['x'.repeat(2048)], 'photo.png', { type: 'image/png' })
    const v = Validator.make(
      { avatar: png },
      { avatar: 'file|image|mimes:png,jpg|max:1' }, // 2KB > 1KB → max fails
    )
    const bag = await v.errors()
    expect(bag.avatar).toBeDefined()
    expect(bag.avatar?.[0]).toContain('kilobytes')

    expect(
      await Validator.make({ avatar: png }, { avatar: 'file|image|mimes:png|max:5' }).passes(),
    ).toBe(true)
  })
})
