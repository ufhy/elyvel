import { BroadcastServiceProvider } from './provider'

export { broadcast, Broadcastable } from './broadcastable'
export { ArrayBroadcaster, type Broadcaster, LogBroadcaster } from './broadcaster'
export { BroadcastChannel } from './channel'
export { type BroadcastConfig, defineBroadcastConfig } from './config-schema'
export { BroadcastHub, type ChannelAuthorizer, type WsData } from './hub'
export { broadcaster, channel, setActiveHub, setDefaultBroadcaster } from './manager'
export { BroadcasterToken, BroadcastServiceProvider } from './provider'
export {
  RedisBroadcaster,
  type RedisConnectionEvent,
  type RedisPublisher,
  type RedisSubscriber,
} from './redis-broadcaster'

/** Read by `elyvel package:discover` — see packages/core's discovery loader. */
export const elyvelProviders = [BroadcastServiceProvider]
