export interface BroadcastConfig {
  /** `websocket` (Bun-native pub/sub), `log`, or `array`. Default `log`. */
  driver?: 'websocket' | 'log' | 'array'
}

/** Typed identity helper for `config/broadcasting.ts`. */
export function defineBroadcastConfig(config: BroadcastConfig): BroadcastConfig {
  return config
}
