import { RedisClient } from 'bun'
import type { QueueConfig, QueueConnectionConfig } from './config-schema'
import { type Job, serializeJob } from './job'
import { DatabaseQueueStore, MemoryQueueStore, type QueueStore, RedisQueueStore } from './store'
import { uniqueKeyFor, uniqueLock } from './unique'

export interface DispatchOptions {
  /** Delay before the job becomes available, in seconds. */
  delay?: number
  /** Target a non-default connection. */
  connection?: string
  /** Named queue (priority lane) to dispatch onto. Defaults to `'default'`. */
  queue?: string
  /**
   * Defer the actual dispatch until the current DB transaction commits (and
   * drop it on rollback). Requires {@link configureAfterCommit}. Overrides the
   * connection's `afterCommit` default.
   */
  afterCommit?: boolean
}

/** Runs `callback` after the current DB transaction commits (or immediately). */
type AfterCommitHook = (callback: () => void | Promise<void>) => void
let afterCommitHook: AfterCommitHook | null = null
/** Wire transaction-aware dispatching (e.g. to `@elysia-ravel/database`'s `afterCommit`). */
export function configureAfterCommit(hook: AfterCommitHook): void {
  afterCommitHook = hook
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
        return new RedisQueueStore(cfg.url ? new RedisClient(cfg.url) : new RedisClient(), cfg.queue ?? 'queues')
      default:
        return 'sync'
    }
  }

  /** Dispatch a job: run inline on `sync`, otherwise enqueue. */
  async push(job: Job, options: DispatchOptions = {}): Promise<void> {
    // Unique jobs: skip the dispatch if a lock is already held.
    const uniqueKey = uniqueKeyFor(job)
    const lock = uniqueLock()
    if (uniqueKey && lock) {
      const acquired = await lock.acquire(uniqueKey, job.uniqueFor ?? 3600)
      if (!acquired) return
    }

    const name = options.connection ?? this.defaultConnection
    const store = this.store(name)
    const doPush = async () => {
      if (store === 'sync') {
        try {
          await job.handle()
        } finally {
          if (uniqueKey && lock) await lock.release(uniqueKey) // no worker to release it
        }
        return
      }
      await store.push(JSON.stringify(serializeJob(job)), { delaySeconds: options.delay ?? 0, queue: options.queue })
    }

    const connCfg = this.config.connections?.[name]
    const useAfterCommit = options.afterCommit ?? connCfg?.afterCommit ?? false
    if (useAfterCommit && afterCommitHook) {
      afterCommitHook(doPush)
      return
    }
    await doPush()
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
