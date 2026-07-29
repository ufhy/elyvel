import type { CacheStore } from './store'

/**
 * Share one in-flight computation per (store, key) across every caller.
 *
 * Scoped to the STORE rather than to a `Repository`/`TaggedCache` instance
 * because those are created per call — `cache().tags('posts')` builds a fresh
 * `TaggedCache` each time, so an instance-local map would never see a
 * concurrent sibling. The store is the actual shared resource, so it's the
 * right key. A `WeakMap` means a discarded store's pending map goes with it.
 */
const inFlight = new WeakMap<CacheStore, Map<string, Promise<unknown>>>()

export function coalesce<T>(store: CacheStore, key: string, compute: () => Promise<T>): Promise<T> {
  let pending = inFlight.get(store)
  if (!pending) {
    pending = new Map()
    inFlight.set(store, pending)
  }
  const existing = pending.get(key) as Promise<T> | undefined
  if (existing)
    return existing
  const promise = compute().finally(() => pending.delete(key))
  pending.set(key, promise)
  return promise
}
