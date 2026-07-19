import { describe, expect, test } from 'bun:test'
import { BroadcastHub } from '../src/hub'
import { RedisBroadcaster } from '../src/redis-broadcaster'

/** Logic-only fake pub/sub — no real Redis server, mirrors other packages' Redis fakes. */
class FakePubSub {
  private readonly listeners = new Map<string, ((message: string, channel: string) => void)[]>()

  async send(command: string, args: string[]): Promise<unknown> {
    if (command !== 'PUBLISH')
      return null
    const [channel, message] = args
    for (const listener of this.listeners.get(channel as string) ?? [])
      listener(message as string, channel as string)
    return 1
  }

  async subscribe(channel: string, listener: (message: string, channel: string) => void): Promise<void> {
    const list = this.listeners.get(channel) ?? []
    list.push(listener)
    this.listeners.set(channel, list)
  }
}

describe('RedisBroadcaster (logic-only fake)', () => {
  test('broadcast() relays through the wire channel into the local hub', async () => {
    const pubsub = new FakePubSub()
    const hub = new BroadcastHub()
    const seen: unknown[] = []
    // Stand in for the local hub's actual WS fan-out — just prove the relay reaches it.
    hub.broadcast = (channels, event, payload) => {
      seen.push({ channels, event, payload })
    }

    const redis = new RedisBroadcaster(pubsub, pubsub, hub)
    await redis.listen()
    await redis.broadcast(['orders'], 'created', { id: 1 })

    expect(seen).toEqual([{ channels: ['orders'], event: 'created', payload: { id: 1 } }])
  })

  test('a custom wire channel is honored end to end', async () => {
    const pubsub = new FakePubSub()
    const hub = new BroadcastHub()
    const seen: unknown[] = []
    hub.broadcast = (channels, event, payload) => seen.push({ channels, event, payload })

    const redis = new RedisBroadcaster(pubsub, pubsub, hub, 'custom-wire')
    await redis.listen()
    await redis.broadcast(['news'], 'update', { a: 1 })

    expect(seen).toHaveLength(1)
  })

  test('two independent broadcasters sharing one bus each relay into their own hub', async () => {
    const pubsub = new FakePubSub() // simulates one shared Redis server
    const hubA = new BroadcastHub()
    const hubB = new BroadcastHub()
    const seenA: unknown[] = []
    const seenB: unknown[] = []
    hubA.broadcast = (channels, event, payload) => seenA.push({ channels, event, payload })
    hubB.broadcast = (channels, event, payload) => seenB.push({ channels, event, payload })

    const instanceA = new RedisBroadcaster(pubsub, pubsub, hubA)
    const instanceB = new RedisBroadcaster(pubsub, pubsub, hubB)
    await instanceA.listen()
    await instanceB.listen()

    // Triggered on instance A — both instances' local hubs must receive it.
    await instanceA.broadcast(['posts.3'], 'CommentBroadcast', { commentId: 9 })

    expect(seenA).toHaveLength(1)
    expect(seenB).toHaveLength(1)
    expect(seenA[0]).toEqual(seenB[0])
  })
})
