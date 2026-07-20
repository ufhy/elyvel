export interface BroadcastConfig {
  /**
   * `websocket` (Bun-native pub/sub — single process only), `redis`
   * (cross-process, for apps running more than one instance), `log`, or
   * `array`. Default `log`.
   */
  driver?: 'websocket' | 'log' | 'array' | 'redis'
  /** Redis connection URL (`redis` driver only). Defaults to Bun's `RedisClient` default (localhost). */
  url?: string
  /** Redis pub/sub channel used to relay broadcasts between instances (`redis` driver only). Default `elyvel-broadcast`. */
  channel?: string
  /**
   * Authenticate an incoming WebSocket upgrade (`websocket`/`redis` drivers
   * only) — return the connecting client's identity (anything JSON-safe,
   * e.g. a user id) to allow the connection, or `null`/`false` to reject it
   * with 401. The returned identity is what `channel()` authorizers receive.
   * Without this, every connection is anonymous, so register it before
   * using `private-`/`presence-` channels — a subscribe attempt there is
   * denied by default when there's no identity to check.
   */
  authenticate?(request: Request): unknown | null | false | Promise<unknown | null | false>
}

/** Typed identity helper for `config/broadcasting.ts`. */
export function defineBroadcastConfig(config: BroadcastConfig): BroadcastConfig {
  return config
}
