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
}

/** Typed identity helper for `config/broadcasting.ts`. */
export function defineBroadcastConfig(config: BroadcastConfig): BroadcastConfig {
  return config
}
