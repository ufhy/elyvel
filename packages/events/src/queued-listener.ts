type AnyEvent = any

/** The queue job context exposed to a running listener (Laravel's InteractsWithQueue). */
export interface ListenerJobContext {
  attempts(): number
  release(delay?: number): void
  delete(): void
}

/**
 * A queued event listener (Laravel's `implements ShouldQueue`). Extend this and
 * implement `handle`; when the event is dispatched, the listener is pushed onto
 * the queue instead of running synchronously (requires a queuer — wire one with
 * {@link configureListenerQueuer}, e.g. `@elyvel/queue`'s `queueListener`).
 *
 * Add any of these optional hooks as plain methods (read via duck-typing):
 *   `shouldQueue(event): boolean` — false to run inline instead of queueing
 *   `viaConnection(): string` / `viaQueue(): string` / `withDelay(event): number`
 *   `failed(event, error)` — called when retries are exhausted
 */
export abstract class QueuedListener<E = AnyEvent> {
  /** Set by the worker before `handle()` runs — InteractsWithQueue plumbing. */
  job?: ListenerJobContext

  abstract handle(event: E, name: string): unknown | Promise<unknown>

  // ── InteractsWithQueue (delegates to the worker's job context) ──────────────
  attempts(): number {
    return this.job?.attempts() ?? 1
  }

  release(delay = 0): void {
    this.job?.release(delay)
  }

  delete(): void {
    this.job?.delete()
  }
}

/**
 * Like {@link QueuedListener}, but only queued after all open DB transactions
 * commit (Laravel's `ShouldQueueAfterCommit`). Relies on the queuer honoring
 * the `afterCommit` flag.
 */
export abstract class QueuedListenerAfterCommit<E = AnyEvent> extends QueuedListener<E> {
  readonly afterCommit = true
}

/** True when a listener should be pushed to the queue rather than run inline. */
export function isQueuedListener(listener: unknown): listener is QueuedListener {
  return listener instanceof QueuedListener
}

// ── injectable queuer (wired by the app, e.g. to @elyvel/queue) ─────────
export type ListenerQueuer = (
  listener: QueuedListener,
  event: AnyEvent,
  name: string,
) => void | Promise<void>

let listenerQueuer: ListenerQueuer | null = null

/** Wire how queued listeners are pushed (e.g. `configureListenerQueuer(queueListener)`). */
export function configureListenerQueuer(queuer: ListenerQueuer): void {
  listenerQueuer = queuer
}

/** The configured queuer, or null. Used by the dispatcher. */
export function listenerQueuerHook(): ListenerQueuer | null {
  return listenerQueuer
}
