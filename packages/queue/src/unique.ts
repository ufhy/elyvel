import type { Job } from './job'

/**
 * A lock backing unique jobs (Laravel's `ShouldBeUnique`). `acquire` returns
 * false when the key is already held; `release` frees it. Back it with a cache
 * (e.g. Redis) for cross-process uniqueness via {@link configureUniqueJobs}.
 */
export interface UniqueLock {
  acquire(key: string, ttlSeconds: number): Promise<boolean>
  release(key: string): Promise<void>
}

/** In-memory unique lock (per-process; dev/tests). */
export class MemoryUniqueLock implements UniqueLock {
  private locks = new Map<string, number>() // key → expiry epoch ms
  async acquire(key: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now()
    const expiry = this.locks.get(key)
    if (expiry !== undefined && expiry > now) return false
    this.locks.set(key, now + ttlSeconds * 1000)
    return true
  }
  async release(key: string): Promise<void> {
    this.locks.delete(key)
  }
}

let lock: UniqueLock | null = null
/** Wire the store backing unique jobs. Without it, `unique` jobs dispatch normally. */
export function configureUniqueJobs(store: UniqueLock): void {
  lock = store
}
export function uniqueLock(): UniqueLock | null {
  return lock
}

/** The lock key for a unique job, or null if the job isn't unique. */
export function uniqueKeyFor(job: Job): string | null {
  if (!job.unique) return null
  const id = job.uniqueId ? job.uniqueId() : ''
  return `unique:${job.constructor.name}:${id}`
}
