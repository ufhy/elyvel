import { RedisClient } from 'bun'
import type { QueueConfig, QueueConnectionConfig } from './config-schema'
import { type Job, serializeJob } from './job'
import { DatabaseQueueStore, MemoryQueueStore, type QueueStore, RedisQueueStore } from './store'

export interface DispatchOptions {
  /** Delay before the job becomes available, in seconds. */
  delay?: number
  /** Target a non-default connection. */
  connection?: string
}

/** Resolves queue connections and dispatches jobs, à la Laravel's QueueManager. */
export class QueueManager {
  private readonly resolved = new Map<string, QueueStore | 'sync'>()
  private readonly defaultConnection: string

  constructor(private readonly config: QueueConfig = {}) {
    this.defaultConnection = config.default ?? 'sync'
  }

  /** The store for a connection, or `'sync'` (run inline). */
  store(name?: string): QueueStore | 'sync' {
    const key = name ?? this.defaultConnection
    let store = this.resolved.get(key)
    if (store === undefined) {
      store = this.build(key)
      this.resolved.set(key, store)
    }
    return store
  }

  private build(name: string): QueueStore | 'sync' {
    const cfg: QueueConnectionConfig | undefined =
      this.config.connections?.[name] ?? (name === 'sync' ? { driver: 'sync' } : undefined)
    if (!cfg) throw new Error(`[elysia-ravel] Queue connection "${name}" is not defined in config/queue.ts.`)
    switch (cfg.driver) {
      case 'memory':
        return new MemoryQueueStore()
      case 'database':
        return new DatabaseQueueStore()
      case 'redis':
        return new RedisQueueStore(cfg.url ? new RedisClient(cfg.url) : new RedisClient(), cfg.queue ?? 'queues:default')
      default:
        return 'sync'
    }
  }

  /** Dispatch a job: run inline on `sync`, otherwise enqueue. */
  async push(job: Job, options: DispatchOptions = {}): Promise<void> {
    const store = this.store(options.connection)
    if (store === 'sync') {
      await job.handle()
      return
    }
    await store.push(JSON.stringify(serializeJob(job)), options.delay ?? 0)
  }

  /** Run a job immediately, bypassing the queue. */
  async pushSync(job: Job): Promise<void> {
    await job.handle()
  }
}

// ── process-wide default (set by QueueServiceProvider at boot) ──────────────
let defaultManager: QueueManager | null = null
export function setDefaultQueue(manager: QueueManager): void {
  defaultManager = manager
}
export function queueManager(): QueueManager {
  if (!defaultManager) defaultManager = new QueueManager()
  return defaultManager
}

/** Dispatch a job onto the queue (Laravel's `dispatch()` helper). */
export function dispatch(job: Job, options?: DispatchOptions): Promise<void> {
  return queueManager().push(job, options)
}
/** Run a job immediately (Laravel's `dispatchSync`). */
export function dispatchSync(job: Job): Promise<void> {
  return queueManager().pushSync(job)
}
