import { ServiceProvider, type Token, token } from '@elysia-ravel/core'
import { ArrayBroadcaster, type Broadcaster, LogBroadcaster } from './broadcaster'
import type { BroadcastConfig } from './config-schema'
import { BroadcastHub } from './hub'
import { setDefaultBroadcaster } from './manager'

export const BroadcasterToken: Token<Broadcaster> = token<Broadcaster>('broadcaster')

/**
 * Boots broadcasting from `config/broadcasting.ts`. For the `websocket` driver
 * it creates a {@link BroadcastHub} and registers its WebSocket handler with the
 * app (so `listen()` upgrades handshakes) — no external service required.
 */
export class BroadcastServiceProvider extends ServiceProvider {
  override register(): void {
    const config = this.app.config.get<BroadcastConfig>('broadcasting', {})
    const driver = config.driver ?? 'log'

    let broadcaster: Broadcaster
    if (driver === 'websocket') {
      const hub = new BroadcastHub()
      this.app.webSocket(hub.websocket, (server) => hub.setServer(server))
      broadcaster = hub
    } else if (driver === 'array') {
      broadcaster = new ArrayBroadcaster()
    } else {
      broadcaster = new LogBroadcaster((line) => this.app.logger.child('broadcast').info(line))
    }

    setDefaultBroadcaster(broadcaster)
    this.app.container.instance(BroadcasterToken, broadcaster)
  }
}
