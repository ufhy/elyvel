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
 * connection.
 */
export interface RedisSubscriber {
  subscribe(channel: string, listener: (message: string, channel: string) => void): Promise<unknown>
}

interface RelayEnvelope {
  channels: string[]
  event: string
  payload: Record<string, unknown>
}

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
  ) {}

  /** Starts relaying incoming envelopes into the local hub. Call once at boot. */
  async listen(): Promise<void> {
    await this.subscriber.subscribe(this.wireChannel, (message) => {
      const envelope = JSON.parse(message) as RelayEnvelope
      this.hub.broadcast(envelope.channels, envelope.event, envelope.payload)
    })
  }

  async broadcast(channels: string[], event: string, payload: Record<string, unknown>): Promise<void> {
    const envelope: RelayEnvelope = { channels, event, payload }
    await this.publisher.send('PUBLISH', [this.wireChannel, JSON.stringify(envelope)])
  }
}
