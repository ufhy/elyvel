import { Job, registerJob } from './job'
import { type DispatchOptions, dispatch } from './manager'

/** Structural shape of a queued event listener (duck-typed — no dep on @elysia-ravel/events). */
interface ListenerLike {
  handle(event: unknown, name: string): unknown | Promise<unknown>
  failed?(event: unknown, error: unknown): unknown | Promise<void>
  viaConnection?: () => string
  viaQueue?: () => string
  withDelay?: (event: unknown) => number
  afterCommit?: boolean
}
type ListenerClass = new () => ListenerLike

const registry = new Map<string, ListenerClass>()

/** Register queued-listener classes so the worker can reconstruct them by name. */
export function registerListener(...classes: ListenerClass[]): void {
  for (const c of classes) registry.set(c.name, c)
}

/**
 * The queue job that carries a queued event listener to the worker. Holds the
 * listener's class name + the event (serialized like any job field), then
 * reconstructs the listener and runs `handle(event)` on the worker.
 */
export class ListenerJob extends Job {
  listenerName = ''
  eventName = ''
  event: unknown = null

  private resolve(): ListenerLike {
    const cls = registry.get(this.listenerName)
    if (!cls) {
      throw new Error(
        `[elysia-ravel] Unknown queued listener "${this.listenerName}". Register it with registerListener().`,
      )
    }
    return new cls()
  }

  async handle(): Promise<void> {
    await this.resolve().handle(this.event, this.eventName)
  }

  override async failed(error: unknown): Promise<void> {
    const cls = registry.get(this.listenerName)
    if (cls) await new cls().failed?.(this.event, error)
  }
}

registerJob(ListenerJob)

/**
 * Push a queued listener onto the queue (wire it via events'
 * `configureListenerQueuer(queueListener)`). Honors the listener's
 * `viaConnection`/`viaQueue`/`withDelay`/`afterCommit`.
 */
export function queueListener(listener: ListenerLike, event: unknown, name: string): Promise<void> {
  const job = new ListenerJob()
  job.listenerName = (listener as { constructor: { name: string } }).constructor.name
  job.eventName = name
  job.event = event

  const opts: DispatchOptions = {}
  if (typeof listener.viaConnection === 'function') opts.connection = listener.viaConnection()
  if (typeof listener.viaQueue === 'function') opts.queue = listener.viaQueue()
  if (typeof listener.withDelay === 'function') opts.delay = listener.withDelay(event)
  if (listener.afterCommit) opts.afterCommit = true

  return dispatch(job, opts)
}
