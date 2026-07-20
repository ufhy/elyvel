import type { Token } from '@elyvel/core'
import type { Broadcaster } from './broadcaster'
import type { BroadcastConfig } from './config-schema'
import { ServiceProvider, token } from '@elyvel/core'
import { RedisClient } from 'bun'
import { ArrayBroadcaster, LogBroadcaster } from './broadcaster'
import { BroadcastHub } from './hub'
import { setActiveHub, setDefaultBroadcaster } from './manager'
import { RedisBroadcaster } from './redis-broadcaster'

export const BroadcasterToken: Token<Broadcaster> = token<Broadcaster>('broadcaster')

/**
 * Boots broadcasting from `config/broadcasting.ts`. For the `websocket`
 * driver it creates a {@link BroadcastHub} and registers its WebSocket
 * handler with the app (so `listen()` upgrades handshakes) — no external
 * service required. `redis` also creates a hub (still needed to serve THIS
 * process's WebSocket clients) but wraps it in a {@link RedisBroadcaster} so
 * broadcasts relay across every instance, not just this one.
 */
export class BroadcastServiceProvider extends ServiceProvider {
  override async register(): Promise<void> {
    const config = this.app.config.get<BroadcastConfig>('broadcasting', {})
    const driver = config.driver ?? 'log'

    let broadcaster: Broadcaster
    if (driver === 'websocket') {
      const hub = new BroadcastHub()
      this.app.webSocket(hub.websocket, server => hub.setServer(server), config.authenticate)
      setActiveHub(hub)
      broadcaster = hub
    }
    else if (driver === 'redis') {
      const hub = new BroadcastHub()
      this.app.webSocket(hub.websocket, server => hub.setServer(server), config.authenticate)
      setActiveHub(hub)
      const publisher = config.url ? new RedisClient(config.url) : new RedisClient()
      const subscriber = config.url ? new RedisClient(config.url) : new RedisClient()
      const log = this.app.logger.child('broadcast')
      const redis = new RedisBroadcaster(publisher, subscriber, hub, config.channel, (event, detail) => {
        if (event === 'disconnected')
          log.error('Redis pub/sub connection dropped — broadcasts will stop relaying until it reconnects', { error: detail })
        else
          log.info('Redis pub/sub connected')
      })
      await redis.listen()
      broadcaster = redis
    }
    else if (driver === 'array') {
      broadcaster = new ArrayBroadcaster()
    }
    else {
      broadcaster = new LogBroadcaster(line => this.app.logger.child('broadcast').debug(line))
    }

    setDefaultBroadcaster(broadcaster)
    this.app.container.instance(BroadcasterToken, broadcaster)
  }
}
