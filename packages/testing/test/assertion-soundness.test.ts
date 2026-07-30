import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { createTestClient } from '../src/client'
import { TestResponse } from '../src/response'

function of(body: unknown): Promise<TestResponse> {
  return TestResponse.of(new Response(JSON.stringify(body)))
}

/**
 * These guard the assertion helpers themselves. A helper that passes without
 * checking is the worst kind of bug in this package: every test written against
 * it goes green while proving nothing, so the failure is invisible by
 * construction.
 *
 * Regression: `containsSubset` used `Array.every` / `Object.entries().every`,
 * both vacuously true over an empty list. So `assertJson({ errors: [] })` PASSED
 * while `errors` held two entries — an assertion written to prove there were no
 * validation errors passed precisely when there were. Laravel compares the value
 * at that point and fails.
 */
describe('an empty expected container asserts emptiness, not "no constraint"', () => {
  test('an empty expected array fails against a populated one', async () => {
    const res = await of({ errors: ['name is required', 'email taken'] })
    expect(() => res.assertJson({ errors: [] })).toThrow()
  })

  test('an empty expected object fails against a populated one', async () => {
    const res = await of({ user: { id: 1, name: 'Ada' } })
    expect(() => res.assertJson({ user: {} })).toThrow()
  })

  test('a nested empty array is checked too', async () => {
    const res = await of({ data: { tags: ['a'] } })
    expect(() => res.assertJson({ data: { tags: [] } })).toThrow()
  })

  test('genuinely empty containers still pass', async () => {
    const res = await of({ errors: [], user: {} })
    expect(() => res.assertJson({ errors: [], user: {} })).not.toThrow()
  })

  test('an object expectation does not match an array of the same length', async () => {
    const res = await of({ items: ['a'] })
    expect(() => res.assertJson({ items: { 0: 'a' } })).toThrow()
  })
})

describe('subset matching still behaves as documented', () => {
  test('a partial object matches', async () => {
    const res = await of({ user: { id: 1, name: 'Ada', email: 'ada@x.io' } })
    expect(() => res.assertJson({ user: { name: 'Ada' } })).not.toThrow()
  })

  test('an array prefix matches', async () => {
    const res = await of({ errors: ['a', 'b', 'c'] })
    expect(() => res.assertJson({ errors: ['a'] })).not.toThrow()
  })

  test('a wrong value fails, and types are not coerced', async () => {
    const res = await of({ count: 2 })
    expect(() => res.assertJson({ count: 3 })).toThrow()
    expect(() => res.assertJson({ count: '2' })).toThrow()
  })
})

/**
 * Regression: `assertJsonPath` compared with `JSON.stringify`, which is key-ORDER
 * sensitive — so asserting `{ id: 1, name: 'Ada' }` against a body that happened
 * to serialize `{ name: 'Ada', id: 1 }` failed a perfectly correct assertion.
 */
describe('assertJsonPath compares structurally, not by serialized text', () => {
  test('key order in an expected object does not matter', async () => {
    const res = await of({ user: { id: 1, name: 'Ada' } })
    expect(() => res.assertJsonPath('user', { name: 'Ada', id: 1 })).not.toThrow()
  })

  test('a missing or extra key still fails', async () => {
    const res = await of({ user: { id: 1, name: 'Ada' } })
    expect(() => res.assertJsonPath('user', { name: 'Ada' })).toThrow()
    expect(() => res.assertJsonPath('user', { id: 1, name: 'Ada', extra: true })).toThrow()
  })

  test('array order DOES matter', async () => {
    const res = await of({ tags: ['a', 'b'] })
    expect(() => res.assertJsonPath('tags', ['a', 'b'])).not.toThrow()
    expect(() => res.assertJsonPath('tags', ['b', 'a'])).toThrow()
  })

  test('scalars and nesting work', async () => {
    const res = await of({ data: { user: { id: 7 } } })
    expect(() => res.assertJsonPath('data.user.id', 7)).not.toThrow()
    expect(() => res.assertJsonPath('data.user.id', 8)).toThrow()
  })
})

/**
 * Regression: the cookie jar stored the empty value from a deleting `Set-Cookie`
 * instead of removing the entry, so the client kept sending `cookie: sess=` after
 * a logout and `cookieJar()` reported a cookie that no longer existed — the test
 * client disagreeing with what a real browser would send.
 */
describe('the cookie jar honours deletion', () => {
  function app(): Elysia {
    return new Elysia()
      .get('/login', ({ set }: any) => {
        set.headers['set-cookie'] = 'sess=abc; Path=/'
        return 'in'
      })
      .get('/logout-max-age', ({ set }: any) => {
        set.headers['set-cookie'] = 'sess=; Path=/; Max-Age=0'
        return 'out'
      })
      .get('/logout-expires', ({ set }: any) => {
        set.headers['set-cookie'] = 'sess=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
        return 'out'
      })
      .get('/whoami', ({ request }: any) => request.headers.get('cookie') ?? '(none)') as unknown as Elysia
  }

  test('Max-Age=0 removes the cookie from the jar and from later requests', async () => {
    const client = createTestClient(app())
    await client.get('/login')
    expect(client.cookieJar().get('sess')).toBe('abc')

    await client.get('/logout-max-age')
    expect(client.cookieJar().has('sess')).toBe(false)
    expect((await client.get('/whoami')).text()).toBe('(none)')
  })

  test('a past Expires does the same', async () => {
    const client = createTestClient(app())
    await client.get('/login')
    await client.get('/logout-expires')
    expect(client.cookieJar().has('sess')).toBe(false)
  })

  test('an ordinary cookie is still captured and replayed', async () => {
    const client = createTestClient(app())
    await client.get('/login')
    expect((await client.get('/whoami')).text()).toBe('sess=abc')
  })
})
