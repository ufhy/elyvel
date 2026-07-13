export interface QueueConnectionConfig {
  driver: 'sync' | 'memory' | 'database' | 'redis'
  /** Redis connection URL (redis driver). Falls back to Bun's default. */
  url?: string
  /** Redis key / logical queue name (redis driver). */
  queue?: string
}

export interface QueueConfig {
  /** Default connection name. Defaults to `sync`. */
  default?: string
  connections?: Record<string, QueueConnectionConfig>
}

/** Typed identity helper for `config/queue.ts`. */
export function defineQueueConfig(config: QueueConfig): QueueConfig {
  return config
}
