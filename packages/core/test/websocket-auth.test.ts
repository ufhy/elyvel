import { describe, expect, test } from 'bun:test'
import { createApp } from '../src/application'

const basePath = new URL('./fixtures', import.meta.url).pathname

// listen() doesn't hand back the bound port when asked for port 0, so pick a
// fixed-but-unlikely-to-collide port per test instead of relying on that.
let nextPort = 18475
function port(): number {
  return nextPort++
}

const wsHeaders = {
  'upgrade': 'websocket',
  'connection': 'upgrade',
  'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
  'sec-websocket-version': '13',
}

describe('Application.webSocket() — authenticate gate', () => {
  test('rejects the upgrade with 401 when authenticate() returns false', async () => {
    const app = await createApp({ basePath, autoloadRoutes: false })
    app.webSocket({ message: () => {} }, undefined, () => false)
    const p = port()
    await app.listen(p)

    const res = await fetch(`http://localhost:${p}`, { headers: wsHeaders })
    expect(res.status).toBe(401)
  })

  test('allows the upgrade anonymously when authenticate() returns null/undefined — distinct from an explicit reject', async () => {
    const app = await createApp({ basePath, autoloadRoutes: false })
    let seenIdentity: unknown = 'not set'
    app.webSocket(
      {
        message: () => {},
        open: (ws: any) => {
          seenIdentity = ws.data.identity
        },
      },
      undefined,
      () => null,
    )
    const p = port()
    await app.listen(p)

    const ws = new WebSocket(`ws://localhost:${p}`)
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve()
      ws.onerror = () => reject(new Error('ws failed to open'))
    })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(seenIdentity).toBeNull() // connected — anonymous, not rejected
    ws.close()
  })

  test('allows the upgrade and stores the resolved identity on ws.data when authenticate() returns truthy', async () => {
    const app = await createApp({ basePath, autoloadRoutes: false })
    let seenIdentity: unknown
    app.webSocket(
      {
        message: () => {},
        open: (ws: any) => {
          seenIdentity = ws.data.identity
        },
      },
      undefined,
      request => request.headers.get('x-user-id') ?? null,
    )
    const p = port()
    await app.listen(p)

    const ws = new WebSocket(`ws://localhost:${p}`, { headers: { 'x-user-id': 'user-42' } } as any)
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve()
      ws.onerror = () => reject(new Error('ws failed to open'))
    })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(seenIdentity).toBe('user-42')
    ws.close()
  })

  test('with no authenticate configured, every upgrade succeeds (anonymous)', async () => {
    const app = await createApp({ basePath, autoloadRoutes: false })
    app.webSocket({ message: () => {} })
    const p = port()
    await app.listen(p)

    const ws = new WebSocket(`ws://localhost:${p}`)
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve()
      ws.onerror = () => reject(new Error('ws failed to open'))
    })
    ws.close()
  })
})
