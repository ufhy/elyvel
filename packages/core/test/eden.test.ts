import { treaty } from '@elysiajs/eden'
import { Elysia } from 'elysia'
import { describe, expect, test } from 'bun:test'
import { route } from '../src/middleware'

/**
 * DX proof for the decoupled (Mode A) / single-origin (Mode B) SPA: a frontend
 * gets full IDE autocompletion + type-checking of the API via Elysia's Eden —
 * no codegen. The app exports its router type (`export type Api = typeof api`)
 * and the client is `treaty<Api>(url)`. We use treaty(instance) in-process so
 * the inferred types are verified by the workspace typecheck itself.
 *
 * NOTE: response types are inferred precisely from both plain Elysia routes and
 * the `route()` helper (its before-hooks are typed `=> Promise<void>`, so the
 * guard short-circuit no longer leaks a `{}` branch). The only residue is that
 * `route()`'s `middleware` macro leaves the URL-prefix segment optional in the
 * Eden proxy (access it with `?.`); the response payload types stay exact.
 */
describe('Eden end-to-end type safety (DX for Mode A/B)', () => {
  const api = new Elysia({ prefix: '/api' })
    .get('/health', () => ({ status: 'ok' as const, uptime: 42 }))
    .get('/users/:id', ({ params }) => ({ id: params.id, name: 'Sam' }))

  // In an app: `export type Api = typeof api` and `treaty<Api>('https://host')`.
  const client = treaty(api)

  test('response type is inferred (autocompletion + type-check)', async () => {
    const { data } = await client.api.health.get()
    // These annotations compile only because Eden inferred the exact response:
    const status: 'ok' | undefined = data?.status
    const uptime: number | undefined = data?.uptime
    expect(status).toBe('ok')
    expect(uptime).toBe(42)
  })

  test('path params are typed', async () => {
    const { data } = await client.api.users({ id: '7' }).get()
    const name: string | undefined = data?.name
    expect(data?.id).toBe('7')
    expect(name).toBe('Sam')
  })

  test('route() helper responses are Eden-clean (no {} branch)', async () => {
    const r = route('/api').get('/health', () => ({ status: 'ok' as const }))
    const rc = treaty(r)
    // The `middleware` macro leaves the prefix segment optional (hence `?.`), but
    // the RESPONSE type is now precise — `data?.status` no longer widens to `{}`.
    const res = await rc.api?.health.get()
    const status: 'ok' | undefined = res?.data?.status
    expect(status).toBe('ok')
  })
})
