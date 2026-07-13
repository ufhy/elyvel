import { treaty } from '@elysiajs/eden'
import { Elysia } from 'elysia'
import { describe, expect, test } from 'bun:test'

/**
 * DX proof for the decoupled (Mode A) / single-origin (Mode B) SPA: a frontend
 * gets full IDE autocompletion + type-checking of the API via Elysia's Eden —
 * no codegen. The app exports its router type (`export type Api = typeof api`)
 * and the client is `treaty<Api>(url)`. We use treaty(instance) in-process so
 * the inferred types are verified by the workspace typecheck itself.
 *
 * NOTE: Eden infers response types precisely from plain Elysia routes. The
 * `route()` helper's `middleware` macro currently widens responses with a `{}`
 * branch (its short-circuit return type leaks in) — so for Eden-typed API
 * endpoints, define them on a plain Elysia instance (still valid in route files)
 * and export its type. See the tracked follow-up to make the macro Eden-clean.
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
})
