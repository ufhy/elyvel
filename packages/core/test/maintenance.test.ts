import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { bringDown, bringUp, isDownForMaintenance, maintenanceMode } from '../src/maintenance'

let dir: string
let file: string
function makeApp() {
  return new Elysia().use(maintenanceMode(file)).get('/', () => 'ok')
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'elyvel-maint-'))
  file = join(dir, 'storage/framework/down')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('maintenance mode', () => {
  test('passes through when up', async () => {
    const res = await makeApp().handle(new Request('http://localhost/'))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
  })

  test('503 HTML for browsers, 503 JSON for API, with Retry-After', async () => {
    bringDown(file, { retryAfter: 120, message: 'Back soon' })
    const app = makeApp()

    const html = await app.handle(new Request('http://localhost/', { headers: { accept: 'text/html' } }))
    expect(html.status).toBe(503)
    expect(html.headers.get('retry-after')).toBe('120')
    expect(await html.text()).toContain('Back soon')

    const api = await app.handle(new Request('http://localhost/', { headers: { accept: 'application/json' } }))
    expect(api.status).toBe(503)
    expect((await api.json() as { message: string }).message).toBe('Back soon')
  })

  test('secret bypass: /?secret sets a cookie, then requests pass', async () => {
    bringDown(file, { secret: 's3cret' })
    const app = makeApp()

    const redirect = await app.handle(new Request('http://localhost/?secret=s3cret'))
    expect(redirect.status).toBe(302)
    const cookie = (redirect.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    expect(cookie).toBe('elyvel_maintenance=s3cret')

    const passed = await app.handle(new Request('http://localhost/', { headers: { cookie } }))
    expect(passed.status).toBe(200)

    // wrong/no cookie still blocked
    const blocked = await app.handle(new Request('http://localhost/'))
    expect(blocked.status).toBe(503)
  })

  test('bringUp restores service', async () => {
    bringDown(file)
    expect(isDownForMaintenance(file)).toBe(true)
    bringUp(file)
    expect(isDownForMaintenance(file)).toBe(false)
    const res = await makeApp().handle(new Request('http://localhost/'))
    expect(res.status).toBe(200)
  })
})
