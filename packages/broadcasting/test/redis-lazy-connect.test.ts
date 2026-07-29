import { describe, expect, test } from 'bun:test'
import { BroadcastHub } from '../src/hub'
import { RedisBroadcaster } from '../src/redis-broadcaster'

/**
 * Faithful on the one detail the previous fake missed: Bun's `RedisClient`
 * connects LAZILY, so `onconnect` fires during the very first command — which,
 * for this broadcaster, is its own initial `subscribe()`.
 */
class LazyFakePubSub {
  private readonly listeners = new Map<string, ((message: string, channel: string) => void)[]>()
  private connected = false
  onclose?: ((error: unknown) => void) | null
  onconnect?: (() => void) | null

  private ensureConnected(): void {
    if (this.connected)
      return
    this.connected = true
    this.onconnect?.()
  }

  async send(command: string, args: string[]): Promise<unknown> {
    this.ensureConnected()
    if (command !== 'PUBLISH')
      return null
    const [channel, message] = args
    for (const listener of this.listeners.get(channel as string) ?? [])
      listener(message as string, channel as string)
    return 1
  }

  async subscribe(channel: string, listener: (message: string, channel: string) => void): Promise<void> {
    this.ensureConnected()
    const list = this.listeners.get(channel) ?? []
    list.push(listener)
    this.listeners.set(channel, list)
  }

  listenerCount(channel: string): number {
    return (this.listeners.get(channel) ?? []).length
  }

  simulateClose(error: unknown): void {
    this.listeners.clear()
    this.connected = false
    this.onclose?.(error)
  }

  simulateReconnect(): void {
    this.ensureConnected()
  }
}

/**
 * Regression: `listen()` installed `onconnect` (which re-subscribes) BEFORE
 * awaiting its initial `subscribeToWireChannel()`. Because Bun connects lazily,
 * that initial subscribe is what fired `onconnect` — registering a SECOND
 * listener on the wire channel. Every relayed envelope then invoked
 * `hub.broadcast` twice, so every WebSocket client received each event twice.
 * Verified against a real Redis before the fix: 2 deliveries for 1 broadcast.
 */
describe('the Redis relay delivers each broadcast exactly once', () => {
  test('a lazy first connect does not register a duplicate listener', async () => {
    const pubsub = new LazyFakePubSub()
    const hub = new BroadcastHub()
    const seen: unknown[] = []
    hub.broadcast = (channels, event, payload) => {
      seen.push({ channels, event, payload })
    }

    const redis = new RedisBroadcaster(pubsub as any, pubsub as any, hub)
    await redis.listen()

    expect(pubsub.listenerCount('elyvel-broadcast')).toBe(1)

    await redis.broadcast(['orders'], 'created', { id: 1 })
    expect(seen).toEqual([{ channels: ['orders'], event: 'created', payload: { id: 1 } }])
  })

  test('a real reconnect still re-subscribes, and still only once', async () => {
    const pubsub = new LazyFakePubSub()
    const hub = new BroadcastHub()
    const seen: unknown[] = []
    hub.broadcast = (channels, event, payload) => {
      seen.push({ channels, event, payload })
    }

    const redis = new RedisBroadcaster(pubsub as any, pubsub as any, hub)
    await redis.listen()

    pubsub.simulateClose(new Error('blip'))
    pubsub.simulateReconnect()
    await Bun.sleep(0) // the re-subscribe is fire-and-forget

    expect(pubsub.listenerCount('elyvel-broadcast')).toBe(1)

    await redis.broadcast(['orders'], 'created', { id: 2 })
    expect(seen).toEqual([{ channels: ['orders'], event: 'created', payload: { id: 2 } }])
  })

  test('a foreign non-JSON message on the wire channel does not kill relaying', async () => {
    const pubsub = new LazyFakePubSub()
    const hub = new BroadcastHub()
    const seen: unknown[] = []
    hub.broadcast = (channels, event, payload) => {
      seen.push({ channels, event, payload })
    }

    const redis = new RedisBroadcaster(pubsub as any, pubsub as any, hub)
    await redis.listen()

    // The wire channel name is configurable and shared by default, so someone
    // else's publisher can land here. Throwing inside the listener would stop
    // relaying entirely.
    await pubsub.send('PUBLISH', ['elyvel-broadcast', 'not json at all'])
    expect(seen).toEqual([])

    await redis.broadcast(['orders'], 'created', { id: 3 })
    expect(seen).toEqual([{ channels: ['orders'], event: 'created', payload: { id: 3 } }])
  })
})
