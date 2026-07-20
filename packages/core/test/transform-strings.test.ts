import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { globalMiddlewarePlugin } from '../src/middleware'
import { ConvertEmptyStringsToNullMiddleware, TrimStringsMiddleware } from '../src/transform-strings'

function buildApp() {
  return new Elysia()
    .use(globalMiddlewarePlugin([TrimStringsMiddleware, ConvertEmptyStringsToNullMiddleware]))
    .post('/echo', ctx => ctx.body, { parse: 'json' })
    .get('/echo-query', ctx => ctx.query)
}

describe('TrimStringsMiddleware + ConvertEmptyStringsToNullMiddleware', () => {
  test('trims whitespace and converts a now-empty string to null in the body', async () => {
    const app = buildApp()
    const res = await app.handle(
      new Request('http://localhost/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '  Ada  ', bio: '   ', tags: ['  a  ', ''] }),
      }),
    )
    expect(await res.json()).toEqual({ name: 'Ada', bio: null, tags: ['a', null] })
  })

  test('recurses into nested objects', async () => {
    const app = buildApp()
    const res = await app.handle(
      new Request('http://localhost/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profile: { nickname: '  Bob  ', notes: '' } }),
      }),
    )
    expect(await res.json()).toEqual({ profile: { nickname: 'Bob', notes: null } })
  })

  test('never touches password fields, at any nesting depth', async () => {
    const app = buildApp()
    const res = await app.handle(
      new Request('http://localhost/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          password: '   secret   ',
          password_confirmation: '',
          nested: { password: '  also-secret  ' },
        }),
      }),
    )
    expect(await res.json()).toEqual({
      password: '   secret   ',
      password_confirmation: '',
      nested: { password: '  also-secret  ' },
    })
  })

  test('trims query string values (but does not null them)', async () => {
    const app = buildApp()
    const res = await app.handle(new Request('http://localhost/echo-query?name=%20Ada%20'))
    expect(await res.json()).toEqual({ name: 'Ada' })
  })
})
