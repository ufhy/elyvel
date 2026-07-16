/**
 * A shared lock backing cross-process scheduling (`withoutOverlapping` across
 * workers, `onOneServer`). Back it with a cache (e.g. Redis) via
 * {@link configureScheduleMutex}; without one, locking stays per-process.
 */
export interface ScheduleMutex {
  /** Acquire `key` for `ttlSeconds`; returns false if already held. */
  create(key: string, ttlSeconds: number): Promise<boolean>
  forget(key: string): Promise<void>
}

/** In-memory mutex (per-process; dev/single-server). */
export class MemoryScheduleMutex implements ScheduleMutex {
  private locks = new Map<string, number>() // key → expiry epoch ms
  async create(key: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now()
    const expiry = this.locks.get(key)
    if (expiry !== undefined && expiry > now)
      return false
    this.locks.set(key, now + ttlSeconds * 1000)
    return true
  }

  async forget(key: string): Promise<void> {
    this.locks.delete(key)
  }
}

let mutex: ScheduleMutex | null = null
export function configureScheduleMutex(store: ScheduleMutex): void {
  mutex = store
}
export function scheduleMutex(): ScheduleMutex | null {
  return mutex
}
