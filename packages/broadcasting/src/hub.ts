import type { Server, WebSocketHandler } from 'bun'
import type { Broadcaster } from './broadcaster'

type AnyServer = Server<undefined>

/**
 * A WebSocket broadcaster built on Bun's native pub/sub — no Pusher/Reverb.
 * Clients connect and send `{ "event": "subscribe", "channel": "orders" }`
 * (or `unsubscribe`); `broadcast()` publishes to everyone on those channels.
 *
 *   const hub = new BroadcastHub()
 *   const server = Bun.serve({ websocket: hub.websocket, fetch(req, s) {
 *     if (s.upgrade(req)) return
 *     return new Response('ok')
 *   }})
 *   hub.setServer(server)
 *   hub.broadcast(['orders'], 'created', { id: 1 })
 */
export class BroadcastHub implements Broadcaster {
  private server: AnyServer | null = null

  /** Bind the running server so `broadcast()` can publish. */
  setServer(server: AnyServer): void {
    this.server = server
  }

  readonly websocket: WebSocketHandler<undefined> = {
    message(ws, raw) {
      try {
        const msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString()) as {
          event?: string
          channel?: string
        }
        if (msg.channel && msg.event === 'subscribe')
          ws.subscribe(msg.channel)
        else if (msg.channel && msg.event === 'unsubscribe')
          ws.unsubscribe(msg.channel)
      }
      catch {
        // ignore malformed frames
      }
    },
  }

  broadcast(channels: string[], event: string, payload: Record<string, unknown>): void {
    if (!this.server)
      return
    for (const channel of channels) {
      this.server.publish(channel, JSON.stringify({ channel, event, payload }))
    }
  }
}
