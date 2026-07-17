import { afterEach, describe, expect, test } from 'bun:test'
import { Http } from '../src/http/client'

afterEach(() => Http.stopFaking())

describe('Http (faked)', () => {
  test('returns a canned JSON response and records the request', async () => {
    Http.fake({ 'https://api.test/users': { status: 200, json: { data: [{ id: 1 }] } } })
    const res = await Http.withToken('t0ken').get('https://api.test/users')
    expect(res.ok).toBe(true)
    expect(res.status).toBe(200)
    expect(res.json<{ data: { id: number }[] }>()).toEqual({ data: [{ id: 1 }] })
    Http.assertSent(r => r.url === 'https://api.test/users' && r.headers.authorization === 'Bearer t0ken')
  })

  test('glob patterns + status helpers', async () => {
    Http.fake({ 'https://api.test/*': { status: 404, json: { message: 'nope' } } })
    const res = await Http.get('https://api.test/missing')
    expect(res.failed).toBe(true)
    expect(res.clientError).toBe(true)
    expect(() => res.throwIfFailed()).toThrow(/status 404/)
  })

  test('withBaseUrl joins relative paths', async () => {
    Http.fake({ '*': { json: { ok: true } } })
    await Http.withBaseUrl('https://api.test/v1').get('users')
    Http.assertSent(r => r.url === 'https://api.test/v1/users')
  })

  test('POST sends a JSON body + content-type', async () => {
    Http.fake({ '*': { status: 201, json: { created: true } } })
    const res = await Http.post('https://api.test/users', { name: 'Ada' })
    expect(res.status).toBe(201)
    Http.assertSent(r =>
      r.method === 'POST'
      && r.body === JSON.stringify({ name: 'Ada' })
      && r.headers['content-type'] === 'application/json')
  })

  test('assertNothingSent passes when idle', () => {
    Http.fake()
    Http.assertNothingSent()
  })

  test('retry re-sends on server error until it gives up', async () => {
    Http.fake({ '*': { status: 500 } })
    const res = await Http.retry(2, 0).get('https://api.test/flaky')
    expect(res.status).toBe(500)
    expect(Http.recorded().length).toBe(3) // initial + 2 retries
  })
})
