import { describe, expect, test } from 'bun:test'
import { Broadcastable, broadcast } from '../src/broadcastable'
import { ArrayBroadcaster } from '../src/broadcaster'
import { BroadcastHub } from '../src/hub'
import { setDefaultBroadcaster } from '../src/manager'

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms))

describe('Broadcastable + broadcast()', () => {
  test('broadcasts on the declared channels with payload', () => {
    const array = new ArrayBroadcaster()
    setDefaultBroadcaster(array)

    class OrderShipped extends Broadcastable {
      constructor(public orderId: number) {
        super()
      }
      broadcastOn() {
        return ['orders', `orders.${this.orderId}`]
      }
    }
    broadcast(new OrderShipped(7))

    expect(array.sent).toHaveLength(1)
    expect(array.sent[0]?.channels).toEqual(['orders', 'orders.7'])
    expect(array.sent[0]?.event).toBe('OrderShipped')
    expect(array.sent[0]?.payload).toEqual({ orderId: 7 })
  })
})

describe('BroadcastHub (live WebSocket round-trip)', () => {
  test('a subscribed client receives a broadcast', async () => {
    const hub = new BroadcastHub()
    const server = Bun.serve({
      port: 0,
      websocket: hub.websocket,
      fetch(req, srv) {
        if (srv.upgrade(req)) return undefined
        return new Response('ok')
      },
    })
    hub.setServer(server)

    try {
      const received: unknown[] = []
      const ws = new WebSocket(`ws://localhost:${server.port}`, [])
      await new Promise<void>((resolve) => {
        ws.onopen = () => resolve()
      })
      ws.onmessage = (e) => received.push(JSON.parse(String(e.data)))

      ws.send(JSON.stringify({ event: 'subscribe', channel: 'orders' }))
      await tick() // let the subscription register

      hub.broadcast(['orders'], 'created', { id: 1 })
      hub.broadcast(['other'], 'nope', { id: 2 }) // client isn't subscribed
      await tick()

      expect(received).toHaveLength(1)
      expect(received[0]).toEqual({ channel: 'orders', event: 'created', payload: { id: 1 } })
      ws.close()
    } finally {
      server.stop(true)
    }
  })

  test('unsubscribe stops delivery', async () => {
    const hub = new BroadcastHub()
    const server = Bun.serve({
      port: 0,
      websocket: hub.websocket,
      fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response('ok')),
    })
    hub.setServer(server)
    try {
      const received: unknown[] = []
      const ws = new WebSocket(`ws://localhost:${server.port}`, [])
      await new Promise<void>((resolve) => {
        ws.onopen = () => resolve()
      })
      ws.onmessage = (e) => received.push(JSON.parse(String(e.data)))
      ws.send(JSON.stringify({ event: 'subscribe', channel: 'news' }))
      await tick()
      ws.send(JSON.stringify({ event: 'unsubscribe', channel: 'news' }))
      await tick()
      hub.broadcast(['news'], 'update', { a: 1 })
      await tick()
      expect(received).toHaveLength(0)
      ws.close()
    } finally {
      server.stop(true)
    }
  })
})
