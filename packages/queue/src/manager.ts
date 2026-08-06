import type { QueueConfig, QueueConnectionConfig } from './config-schema'
import type { Job } from './job'
import type { QueueStore } from './store'
import { DriverRegistry } from '@elyvel/support'
import { RedisClient } from 'bun'
import { signClosure } from './closure-signing'
import { CallQueuedClosure, encodeBody, serializeJob } from './job'
import { DatabaseQueueStore, MemoryQueueStore, RedisQueueStore } from './store'
import { uniqueKeyFor, uniqueLock } from './unique'

/** A job instance or a self-contained closure to queue. */
export type Dispatchable = Job | (() => void | Promise<void>)

/**
 * Normalize a dispatchable into a Job (wrapping closures). A closure is signed
 * here, at the last point the source is still known to come from this
 * application's own code.
 */
function toJob(dispatchable: Dispatchable): Job {
  if (typeof dispatchable !== 'function')
    return dispatchable
  const source = dispatchable.toString()
  return new CallQueuedClosure(source, signClosure(source))
}

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
/** Wire transaction-aware dispatching (e.g. to `@elyvel/database`'s `afterCommit`). */
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

  /** Built-ins go through the same door `extend()` uses. */
  private readonly stores = new DriverRegistry<QueueStore | 'sync', QueueConnectionConfig>(
    'Queue driver',
    'Register it with `QueueManager.extend(name, factory)` from a provider.',
  )
    .register('sync', () => 'sync')
    .register('memory', () => new MemoryQueueStore())
    .register('database', () => new DatabaseQueueStore())
    .register('redis', (cfg: QueueConnectionConfig) => new RedisQueueStore(
      cfg.url ? new RedisClient(cfg.url) : new RedisClient(),
      cfg.queue ?? 'queues',
    ))

  private build(name: string): QueueStore | 'sync' {
    const cfg: QueueConnectionConfig | undefined
      = this.config.connections?.[name] ?? (name === 'sync' ? { driver: 'sync' } : undefined)
    if (!cfg) {
      throw new Error(
        `[elyvel] Queue connection "${name}" is not defined in config/queue.ts.`,
      )
    }
    return this.stores.resolve(cfg.driver ?? 'sync', cfg)
  }

  /**
   * Register a queue backend the framework doesn't ship — Laravel's
   * `Queue::extend()`. SQS, Beanstalk, a hosted queue: the `QueueStore`
   * interface was always public, but a `switch` decided which names existed.
   */
  extend(name: string, factory: (config: QueueConnectionConfig, name: string) => QueueStore | 'sync'): this {
    this.stores.extend(name, factory)
    this.resolved.delete(name)
    return this
  }

  /** Every connection driver this manager can build. */
  availableDrivers(): string[] {
    return this.stores.names()
  }

  /** Dispatch a job (or closure): run inline on `sync`, otherwise enqueue. */
  async push(dispatchable: Dispatchable, options: DispatchOptions = {}): Promise<void> {
    const job = toJob(dispatchable)
    const uniqueKey = uniqueKeyFor(job)
    const lock = uniqueLock()

    const name = options.connection ?? this.defaultConnection
    const store = this.store(name)
    const doPush = async () => {
      // Unique jobs: skip the dispatch if a lock is already held. Acquired
      // HERE rather than before this closure, because the closure may be
      // deferred to after-commit (and dropped entirely on rollback) or may
      // throw partway. Taking the lock up front leaked it in both cases: no
      // job was queued, yet the lock stayed held for `uniqueFor` (an hour by
      // default), so every later dispatch of that job silently did nothing.
      if (uniqueKey && lock) {
        const acquired = await lock.acquire(uniqueKey, job.uniqueFor ?? 3600)
        if (!acquired)
          return
      }
      if (store === 'sync') {
        try {
          await job.handle()
        }
        finally {
          if (uniqueKey && lock)
            await lock.release(uniqueKey) // no worker to release it
        }
        return
      }
      try {
        await store.push(encodeBody(serializeJob(job)), {
          delaySeconds: options.delay ?? 0,
          queue: options.queue,
        })
      }
      catch (error) {
        // Nothing was queued, so nothing will ever release this.
        if (uniqueKey && lock)
          await lock.release(uniqueKey)
        throw error
      }
    }

    const connCfg = this.config.connections?.[name]
    const useAfterCommit = options.afterCommit ?? connCfg?.afterCommit ?? false
    if (useAfterCommit && afterCommitHook) {
      afterCommitHook(doPush)
      return
    }
    await doPush()
  }

  /** Run a job (or closure) immediately, bypassing the queue. */
  async pushSync(dispatchable: Dispatchable): Promise<void> {
    await toJob(dispatchable).handle()
  }
}

// ── process-wide default (set by QueueServiceProvider at boot) ──────────────
let defaultManager: QueueManager | null = null
export function setDefaultQueue(manager: QueueManager): void {
  defaultManager = manager
}
export function queueManager(): QueueManager {
  if (!defaultManager)
    defaultManager = new QueueManager()
  return defaultManager
}

/** Dispatch a job or closure onto the queue (Laravel's `dispatch()` helper). */
export function dispatch(dispatchable: Dispatchable, options?: DispatchOptions): Promise<void> {
  return queueManager().push(dispatchable, options)
}
/** Run a job or closure immediately (Laravel's `dispatchSync`). */
export function dispatchSync(dispatchable: Dispatchable): Promise<void> {
  return queueManager().pushSync(dispatchable)
}
