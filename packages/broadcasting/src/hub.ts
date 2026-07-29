import type { Server, WebSocketHandler } from 'bun'
import type { Broadcaster } from './broadcaster'
import { trans } from '@elyvel/support'

/** Data Bun stores per-connection (set at `server.upgrade(request, { data })`). */
export interface WsData {
  /** Whatever `BroadcastConfig.authenticate()` returned for this connection — `undefined` if none was configured (anonymous connection). */
  identity?: unknown
}

type AnyServer = Server<WsData>

/**
 * Decide whether `identity` may subscribe to a private/presence channel,
 * given the params captured from its `{placeholder}` segments (Laravel's
 * `Broadcast::channel()` callback).
 */
export type ChannelAuthorizer = (identity: unknown, params: Record<string, string>) => boolean | Promise<boolean>

interface CompiledAuthorizer {
  regex: RegExp
  paramNames: string[]
  authorize: ChannelAuthorizer
}

/** Compile `"private-orders.{orderId}"` into a matching regex + param names. */
function compilePattern(pattern: string): { regex: RegExp, paramNames: string[] } {
  const paramNames: string[] = []
  let source = ''
  let i = 0
  while (i < pattern.length) {
    const char = pattern[i]
    if (char === '{') {
      const end = pattern.indexOf('}', i)
      if (end === -1)
        throw new Error(`[elyvel] invalid channel pattern "${pattern}" — unclosed "{"`)
      paramNames.push(pattern.slice(i + 1, end))
      source += '([^.]+)'
      i = end + 1
    }
    else {
      source += char!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      i++
    }
  }
  return { regex: new RegExp(`^${source}$`), paramNames }
}

/**
 * A WebSocket broadcaster built on Bun's native pub/sub — no Pusher/Reverb.
 * Clients connect and send `{ "event": "subscribe", "channel": "orders" }`
 * (or `unsubscribe`); `broadcast()` publishes to everyone on those channels.
 *
 * Channels named `private-*`/`presence-*` require an authorization rule
 * registered via {@link channel} (Laravel's `Broadcast::channel()`) — a
 * subscribe attempt with no matching rule is denied by default. Plain
 * channel names (no prefix) stay public, same as Laravel.
 *
 *   const hub = new BroadcastHub()
 *   const server = Bun.serve({ websocket: hub.websocket, fetch(req, s) {
 *     if (s.upgrade(req)) return
 *     return new Response('ok')
 *   }})
 *   hub.setServer(server)
 *   hub.channel('private-orders.{orderId}', (identity, { orderId }) => ownsOrder(identity, orderId))
 *   hub.broadcast(['orders'], 'created', { id: 1 })
 */
export class BroadcastHub implements Broadcaster {
  private server: AnyServer | null = null
  private readonly authorizers: CompiledAuthorizer[] = []

  /** Bind the running server so `broadcast()` can publish. */
  setServer(server: AnyServer): void {
    this.server = server
  }

  /** Register an authorization rule for a `private-`/`presence-` channel pattern. */
  channel(pattern: string, authorize: ChannelAuthorizer): void {
    const { regex, paramNames } = compilePattern(pattern)
    this.authorizers.push({ regex, paramNames, authorize })
  }

  private async isAuthorized(channelName: string, identity: unknown): Promise<boolean> {
    if (!channelName.startsWith('private-') && !channelName.startsWith('presence-'))
      return true
    for (const a of this.authorizers) {
      const match = a.regex.exec(channelName)
      if (match) {
        const params: Record<string, string> = {}
        a.paramNames.forEach((name, idx) => {
          params[name] = match[idx + 1]!
        })
        return await a.authorize(identity, params)
      }
    }
    // A private/presence channel with no registered rule is inaccessible —
    // same as Laravel: you must define a channel route before anyone can
    // subscribe. Without this, a bare "private-" prefix would be private in
    // name only.
    return false
  }

  readonly websocket: WebSocketHandler<WsData> = {
    message: async (ws, raw) => {
      let msg: { event?: string, channel?: string }
      try {
        msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString()) as {
          event?: string
          channel?: string
        }
      }
      catch {
        return // ignore malformed frames
      }
      if (msg.channel && msg.event === 'subscribe') {
        // An authorizer that throws (a failed DB lookup, a bug) used to reject
        // inside this async handler with nothing catching it: the client got
        // neither a subscription nor a `subscription_error` and simply hung,
        // while the process logged an unhandled rejection. Fail CLOSED and tell
        // the client.
        let allowed: boolean
        try {
          allowed = await this.isAuthorized(msg.channel, ws.data?.identity)
        }
        catch {
          allowed = false
        }
        if (allowed) {
          ws.subscribe(msg.channel)
        }
        else {
          ws.send(JSON.stringify({
            channel: msg.channel,
            event: 'subscription_error',
            payload: { message: trans('broadcasting::errors.unauthorized', {}, 'Unauthorized') },
          }))
        }
      }
      else if (msg.channel && msg.event === 'unsubscribe') {
        ws.unsubscribe(msg.channel)
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
