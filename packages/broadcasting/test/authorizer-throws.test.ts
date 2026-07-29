import { describe, expect, test } from 'bun:test'
import { BroadcastHub } from '../src/hub'

/** Minimal stand-in for a Bun WebSocket, capturing what the hub sends back. */
function fakeSocket(identity?: unknown): {
  sent: string[]
  subscribed: string[]
  data: { identity?: unknown }
  send(s: string): void
  subscribe(c: string): void
  unsubscribe(c: string): void
} {
  const sent: string[] = []
  const subscribed: string[] = []
  return {
    sent,
    subscribed,
    data: { identity },
    send: (s: string) => void sent.push(s),
    subscribe: (c: string) => void subscribed.push(c),
    unsubscribe: () => {},
  }
}

/**
 * Regression: `await this.isAuthorized(...)` sat unguarded inside the async
 * `message` handler. An authorizer that threw — a failed DB lookup, a bug —
 * rejected with nothing catching it: the client received neither a subscription
 * nor a `subscription_error` and simply hung, while the process logged an
 * unhandled rejection.
 */
describe('a throwing channel authorizer denies instead of hanging the client', () => {
  test('the client gets a subscription_error, not silence', async () => {
    const hub = new BroadcastHub()
    hub.channel('private-orders.{id}', () => {
      throw new Error('database is down')
    })

    const ws = fakeSocket({ id: 1 })
    await hub.websocket.message!(
      ws as any,
      JSON.stringify({ event: 'subscribe', channel: 'private-orders.7' }),
    )

    expect(ws.subscribed).toEqual([])
    expect(ws.sent).toHaveLength(1)
    expect(JSON.parse(ws.sent[0]!).event).toBe('subscription_error')
  })

  test('an authorizer rejecting asynchronously also denies', async () => {
    const hub = new BroadcastHub()
    hub.channel('private-orders.{id}', async () => {
      throw new Error('lookup failed')
    })

    const ws = fakeSocket({ id: 1 })
    await hub.websocket.message!(
      ws as any,
      JSON.stringify({ event: 'subscribe', channel: 'private-orders.7' }),
    )

    expect(ws.subscribed).toEqual([])
    expect(JSON.parse(ws.sent[0]!).event).toBe('subscription_error')
  })

  test('a healthy authorizer still permits and still denies on false', async () => {
    const hub = new BroadcastHub()
    hub.channel('private-orders.{id}', (identity: any, params) => String(identity?.id) === params.id)

    const owner = fakeSocket({ id: 7 })
    await hub.websocket.message!(
      owner as any,
      JSON.stringify({ event: 'subscribe', channel: 'private-orders.7' }),
    )
    expect(owner.subscribed).toEqual(['private-orders.7'])

    const stranger = fakeSocket({ id: 9 })
    await hub.websocket.message!(
      stranger as any,
      JSON.stringify({ event: 'subscribe', channel: 'private-orders.7' }),
    )
    expect(stranger.subscribed).toEqual([])
    expect(JSON.parse(stranger.sent[0]!).event).toBe('subscription_error')
  })
})
