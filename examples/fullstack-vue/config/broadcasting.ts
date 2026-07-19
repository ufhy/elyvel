import { defineBroadcastConfig } from '@elyvel/broadcasting'

/**
 * Broadcasting driver. `websocket` (this app's default) uses Bun's native
 * WebSocket pub/sub, so new blog comments show up live for anyone else
 * viewing the same post — see `resources/js/pages/Blog/Show.vue`.
 */
export default defineBroadcastConfig({
  driver: (process.env.BROADCAST_DRIVER as 'websocket' | 'log' | 'array' | undefined) ?? 'websocket',
})
