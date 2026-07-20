import type { Broadcaster } from './broadcaster'
import type { BroadcastHub, ChannelAuthorizer } from './hub'

let defaultBroadcaster: Broadcaster | null = null
let activeHub: BroadcastHub | null = null

export function setDefaultBroadcaster(broadcaster: Broadcaster): void {
  defaultBroadcaster = broadcaster
}

export function broadcaster(): Broadcaster {
  if (!defaultBroadcaster) {
    throw new Error(
      '[elyvel] Broadcasting is not configured. Register BroadcastServiceProvider.',
    )
  }
  return defaultBroadcaster
}

/** Set by `BroadcastServiceProvider` for the `websocket`/`redis` drivers — the only ones with a hub to authorize channels on. */
export function setActiveHub(hub: BroadcastHub): void {
  activeHub = hub
}

/**
 * Register an authorization rule for a `private-`/`presence-` channel
 * pattern (Laravel's `Broadcast::channel()`), e.g.:
 * `channel('private-orders.{orderId}', (identity, { orderId }) => ownsOrder(identity, orderId))`.
 * Only meaningful for the `websocket`/`redis` drivers — throws otherwise,
 * since `log`/`array` never accept subscriptions to authorize.
 */
export function channel(pattern: string, authorize: ChannelAuthorizer): void {
  if (!activeHub) {
    throw new Error(
      '[elyvel] channel() needs the `websocket` or `redis` broadcasting driver (config/broadcasting.ts).',
    )
  }
  activeHub.channel(pattern, authorize)
}
