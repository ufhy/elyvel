/**
 * Process-wide queue lifecycle hooks (Laravel's `Queue::before` / `after` /
 * `failing`). The worker fires these for every job, in addition to any
 * per-worker callbacks. Useful for metrics/logging across all jobs.
 */
type BeforeListener = (name: string) => void | Promise<void>
type AfterListener = (name: string) => void | Promise<void>
type FailingListener = (name: string, error: unknown) => void | Promise<void>

const beforeListeners: BeforeListener[] = []
const afterListeners: AfterListener[] = []
const failingListeners: FailingListener[] = []

export const Queue = {
  /** Runs before every job's handle(). */
  before(listener: BeforeListener): void {
    beforeListeners.push(listener)
  },
  /** Runs after every job's handle() succeeds. */
  after(listener: AfterListener): void {
    afterListeners.push(listener)
  },
  /** Runs whenever a job throws (each attempt). */
  failing(listener: FailingListener): void {
    failingListeners.push(listener)
  },
  /** Remove all registered listeners (mainly for tests). */
  clearListeners(): void {
    beforeListeners.length = 0
    afterListeners.length = 0
    failingListeners.length = 0
  },
}

/**
 * Optional bridge so queue lifecycle events also flow through an app-wide event
 * dispatcher (like the Eloquent bridge). Wire it once at boot, e.g.
 * `configureQueueEventDispatcher((name, payload) => event(name, payload))`, then
 * `listen('queue.failed', ...)`. Kept injectable so the queue package stays
 * decoupled from `@elyvel/events`.
 */
type QueueEventDispatcher = (
  eventName: string,
  payload: Record<string, unknown>,
) => void | Promise<void>
let queueEventDispatcher: QueueEventDispatcher | null = null
export function configureQueueEventDispatcher(dispatcher: QueueEventDispatcher): void {
  queueEventDispatcher = dispatcher
}

export async function fireBefore(name: string): Promise<void> {
  for (const l of beforeListeners) await l(name)
  if (queueEventDispatcher)
    await queueEventDispatcher('queue.processing', { job: name })
}
export async function fireAfter(name: string): Promise<void> {
  for (const l of afterListeners) await l(name)
  if (queueEventDispatcher)
    await queueEventDispatcher('queue.processed', { job: name })
}
export async function fireFailing(name: string, error: unknown): Promise<void> {
  for (const l of failingListeners) await l(name, error)
  if (queueEventDispatcher)
    await queueEventDispatcher('queue.failed', { job: name, error })
}
