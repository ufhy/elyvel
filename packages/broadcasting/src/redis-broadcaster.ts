import type { Broadcaster } from './broadcaster'
import type { BroadcastHub } from './hub'

/** The publish side — same minimal `.send()` shape as other elyvel Redis stores. */
export interface RedisPublisher {
  send(command: string, args: string[]): Promise<unknown>
}

/**
 * The subscribe side — deliberately a SEPARATE connection from the publisher.
 * Once a Redis client issues `.subscribe()` it enters subscribe mode and can
 * no longer run ordinary commands (Bun's `RedisClient` enforces this, same as
 * classic Redis clients), so publish and subscribe can never share one
 * connection. `onclose`/`onconnect` are optional — Bun's real `RedisClient`
 * exposes both (settable hooks, not an event emitter); a minimal test fake
 * can omit them.
 */
export interface RedisSubscriber {
  subscribe(channel: string, listener: (message: string, channel: string) => void): Promise<unknown>
  onclose?: ((error: any) => void) | null
  onconnect?: (() => void) | null
}

interface RelayEnvelope {
  channels: string[]
  event: string
  payload: Record<string, unknown>
}

/** Reported to {@link RedisBroadcaster}'s `onConnectionEvent` (if given) so an app can log/alert on it. */
export type RedisConnectionEvent = 'connected' | 'disconnected'

/**
 * Cross-process broadcasting over Redis pub/sub — fixes `BroadcastHub`'s
 * single-process limit (behind a load balancer with N instances, only
 * clients connected to the SAME instance that triggered a broadcast would
 * ever see it, since Bun's native pub/sub is in-process memory).
 *
 * Design: rather than subscribing per-channel on Redis (channel names are
 * arbitrary app strings decided at broadcast time — you can't pre-subscribe
 * to something you don't know yet), every instance relays through ONE fixed
 * Redis channel carrying the full `{channels, event, payload}` envelope.
 * Every instance (including the one that triggered the broadcast) receives
 * its own relay message and re-broadcasts it through its OWN local
 * `BroadcastHub` — reaching only the WebSocket clients connected to that
 * instance. Same idea as the socket.io Redis adapter.
 */
export class RedisBroadcaster implements Broadcaster {
  constructor(
    private readonly publisher: RedisPublisher,
    private readonly subscriber: RedisSubscriber,
    private readonly hub: BroadcastHub,
    private readonly wireChannel = 'elyvel-broadcast',
    /**
     * Without this, a dropped Redis connection (network blip, Redis
     * restart) silently stopped relaying broadcasts to this instance's
     * WebSocket clients with no trace anywhere — the exact "mail/
     * notifications silently dropped" class of bug already fixed
     * elsewhere in this framework, just not here yet.
     */
    private readonly onConnectionEvent?: (event: RedisConnectionEvent, detail?: unknown) => void,
  ) {}

  private subscribed = false

  /** Starts relaying incoming envelopes into the local hub. Call once at boot. */
  async listen(): Promise<void> {
    this.subscriber.onclose = (error) => {
      this.onConnectionEvent?.('disconnected', error)
    }
    this.subscriber.onconnect = () => {
      this.onConnectionEvent?.('connected')
      // Bun's RedisClient auto-reconnects the socket, but a fresh
      // connection doesn't know about SUBSCRIBE commands issued on the
      // old one — re-issue it every (re)connect so relaying actually
      // resumes rather than silently staying dark after a blip.
      //
      // Only on a RE-connect, though. Bun connects lazily, so the very first
      // `subscribe()` below is itself what triggers `onconnect` — re-issuing
      // there registered a SECOND listener on the same channel and every
      // broadcast was relayed into the hub TWICE, so every WebSocket client
      // received each event twice.
      if (this.subscribed)
        void this.subscribeToWireChannel()
    }
    await this.subscribeToWireChannel()
    this.subscribed = true
  }

  /**
   * One stable listener reference. Bun keys pub/sub listeners by reference, so
   * passing a fresh arrow function per subscribe ADDS a listener rather than
   * replacing it — the second half of the double-delivery bug above.
   */
  private readonly relay = (message: string): void => {
    let envelope: RelayEnvelope
    try {
      envelope = JSON.parse(message) as RelayEnvelope
    }
    catch {
      // The wire channel name is configurable and defaults to a shared
      // `elyvel-broadcast`, so a foreign publisher can land a non-JSON message
      // here. Throwing inside the listener would take down relaying entirely.
      return
    }
    this.hub.broadcast(envelope.channels, envelope.event, envelope.payload)
  }

  private async subscribeToWireChannel(): Promise<void> {
    await this.subscriber.subscribe(this.wireChannel, this.relay)
  }

  async broadcast(channels: string[], event: string, payload: Record<string, unknown>): Promise<void> {
    const envelope: RelayEnvelope = { channels, event, payload }
    await this.publisher.send('PUBLISH', [this.wireChannel, JSON.stringify(envelope)])
  }
}
