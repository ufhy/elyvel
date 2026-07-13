import { defineBroadcastConfig } from '@elysia-ravel/broadcasting'

/**
 * Broadcasting config. `websocket` runs a Bun-native WebSocket pub/sub server
 * (the app upgrades WS handshakes on `listen()`); clients subscribe with
 * `{ "event": "subscribe", "channel": "..." }`. `log`/`array` for dev/tests.
 */
export default defineBroadcastConfig({
  driver: (process.env.BROADCAST_DRIVER as 'websocket' | 'log' | 'array') ?? 'websocket',
})
