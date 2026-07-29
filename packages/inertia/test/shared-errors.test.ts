import { describe, expect, test } from 'bun:test'
import { buildProps, Inertia } from '../src/response'

function request(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/posts', { headers })
}

/**
 * Regression: `merged.errors = session?.get('errors') ?? {}` ran AFTER both
 * shared maps were copied and assigned unconditionally, so
 * `Inertia.share('errors', …)` was discarded even with no session errors. A
 * second unconditional `out.errors = merged.errors` at the end then overwrote
 * the value the prop loop had already resolved with the RAW one, so a lazy
 * share reached the client as the function itself.
 */
describe('shared errors are not silently discarded', () => {
  test('a shared errors value survives when the session has none', async () => {
    Inertia.flushShared()
    Inertia.share('errors', { email: ['Taken.'] })

    const built = await buildProps(Inertia.render('Posts/Index'), request(), undefined)
    expect(built.props.errors).toEqual({ email: ['Taken.'] })
    Inertia.flushShared()
  })

  test('a lazy shared errors value is resolved, not passed through as a function', async () => {
    Inertia.flushShared()
    Inertia.share('errors', () => ({ email: ['Lazy.'] }))

    const built = await buildProps(Inertia.render('Posts/Index'), request(), undefined)
    expect(built.props.errors).toEqual({ email: ['Lazy.'] })
    expect(typeof built.props.errors).toBe('object')
    Inertia.flushShared()
  })

  test('flashed session errors still win — that is the redirect contract', async () => {
    Inertia.flushShared()
    Inertia.share('errors', { email: ['From share.'] })

    const session = { get: (key: string) => (key === 'errors' ? { name: ['Required.'] } : undefined) }
    const built = await buildProps(Inertia.render('Posts/Index'), request(), session)
    expect(built.props.errors).toEqual({ name: ['Required.'] })
    Inertia.flushShared()
  })

  test('with neither source, errors is an empty object', async () => {
    Inertia.flushShared()
    const built = await buildProps(Inertia.render('Posts/Index'), request(), undefined)
    expect(built.props.errors).toEqual({})
  })

  test('errors still survives partial-reload filtering', async () => {
    Inertia.flushShared()
    const built = await buildProps(
      Inertia.render('Posts/Index', { other: 1 }),
      request({
        'x-inertia-partial-component': 'Posts/Index',
        'x-inertia-partial-data': 'other',
      }),
      { get: (key: string) => (key === 'errors' ? { name: ['Required.'] } : undefined) },
    )
    expect(built.props.errors).toEqual({ name: ['Required.'] })
  })
})
