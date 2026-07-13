export interface QueueConnectionConfig {
  driver: 'sync' | 'memory' | 'database' | 'redis'
  /** Redis connection URL (redis driver). Falls back to Bun's default. */
  url?: string
  /** Redis key prefix (redis driver); named lanes become `<prefix>:<queue>`. Default 'queues'. */
  queue?: string
  /** Default all dispatches on this connection to fire after the DB commits. */
  afterCommit?: boolean
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
