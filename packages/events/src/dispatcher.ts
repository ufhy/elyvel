import { isQueuedListener, listenerQueuerHook } from './queued-listener'

type AnyEvent = any
type EventClass<E = AnyEvent> = new (...args: any[]) => E
/** Event identifier: a class constructor or a string name. */
export type EventKey<E = AnyEvent> = EventClass<E> | string
/** A listener: a function, or an object/class instance with `handle`. */
export type Listener<E = AnyEvent>
  = | ((event: E, name: string) => unknown | Promise<unknown>)
    | { handle(event: E, name: string): unknown | Promise<unknown> }

/** An event subscriber declares its own listener mappings. */
export interface Subscriber {
  subscribe(dispatcher: Dispatcher): void
}

const WILDCARD = '*'

function keyOf(event: EventKey): string {
  return typeof event === 'string' ? event : event.name
}
function nameOfInstance(event: object): string {
  return (event as { constructor: { name: string } }).constructor.name
}
async function invoke(listener: Listener, event: AnyEvent, name: string): Promise<unknown> {
  // A ShouldQueue listener is pushed to the queue (via the wired queuer) instead
  // of running inline — unless shouldQueue(event) opts out, or no queuer is set.
  if (isQueuedListener(listener)) {
    const queuer = listenerQueuerHook()
    const shouldQueue = (listener as { shouldQueue?(e: AnyEvent): boolean }).shouldQueue
    if (queuer && shouldQueue?.(event) !== false) {
      await queuer(listener, event, name)
      return undefined
    }
    return listener.handle(event, name) // no queuer configured → run inline
  }
  return typeof listener === 'function' ? listener(event, name) : listener.handle(event, name)
}

/**
 * Event dispatcher, à la Laravel. Register listeners by event class or name,
 * then `dispatch` an event instance (or a name + payload). Listeners run in
 * registration order; `until` stops at the first non-null return.
 */
export class Dispatcher {
  private readonly listeners = new Map<string, Listener[]>()
  private readonly pushed = new Map<string, AnyEvent[]>()

  /** Register a listener for an event class or string name (or `'*'` for all). */
  listen<E>(event: EventKey<E>, listener: Listener<E>): this {
    const key = keyOf(event)
    const list = this.listeners.get(key) ?? []
    list.push(listener as Listener)
    this.listeners.set(key, list)
    return this
  }

  hasListeners(event: EventKey): boolean {
    return (this.listeners.get(keyOf(event))?.length ?? 0) > 0
  }

  forget(event: EventKey): void {
    this.listeners.delete(keyOf(event))
  }

  /** Register a subscriber's listener mappings. */
  subscribe(subscriber: Subscriber): this {
    subscriber.subscribe(this)
    return this
  }

  private listenersFor(name: string): Listener[] {
    return [...(this.listeners.get(name) ?? []), ...(this.listeners.get(WILDCARD) ?? [])]
  }

  /**
   * Dispatch an event. Pass an event instance, or a string name + payload.
   * Returns the array of listener results (nulls filtered out).
   */
  async dispatch<E extends object>(event: E): Promise<unknown[]>
  async dispatch(name: string, payload?: AnyEvent): Promise<unknown[]>
  async dispatch(event: object | string, payload?: AnyEvent): Promise<unknown[]> {
    const name = typeof event === 'string' ? event : nameOfInstance(event)
    const value = typeof event === 'string' ? payload : event

    // ShouldDispatchAfterCommit: defer until the DB transaction commits.
    if (afterCommitHook && shouldDispatchAfterCommit(value)) {
      afterCommitHook(() => {
        void this.run(name, value)
      })
      return []
    }
    return this.run(name, value)
  }

  /** Run listeners for `name`; a listener returning `false` halts propagation. */
  private async run(name: string, value: AnyEvent): Promise<unknown[]> {
    const results: unknown[] = []
    for (const listener of this.listenersFor(name)) {
      const result = await invoke(listener, value, name)
      if (result === false)
        break // stop propagation
      if (result !== null && result !== undefined)
        results.push(result)
    }
    return results
  }

  /** Queue an event by name to be dispatched later with {@link flush}. */
  push(name: string, payload?: AnyEvent): void {
    const list = this.pushed.get(name) ?? []
    list.push(payload)
    this.pushed.set(name, list)
  }

  /** Dispatch (and clear) all events pushed under `name`. */
  async flush(name: string): Promise<void> {
    const list = this.pushed.get(name) ?? []
    // Drop each payload only once it has actually been dispatched. Clearing
    // the whole list up front meant a listener throwing on payload #1
    // discarded #2..N — already gone from the map, never dispatched, and
    // unrecoverable.
    while (list.length > 0) {
      await this.dispatch(name, list[0])
      list.shift()
    }
    this.pushed.delete(name)
  }

  /** Dispatch until a listener returns a non-null value; returns that value. */
  async until<E extends object>(event: E): Promise<unknown> {
    const name = nameOfInstance(event)
    for (const listener of this.listenersFor(name)) {
      const result = await invoke(listener, event, name)
      if (result !== null && result !== undefined)
        return result
    }
    return null
  }
}

// ── dispatch-after-commit ─────────────────────────────────────────────────────
type AfterCommitHook = (callback: () => void) => void
let afterCommitHook: AfterCommitHook | null = null
/** Wire transaction-aware event dispatch (e.g. to `@elyvel/database`'s `afterCommit`). */
export function configureEventAfterCommit(hook: AfterCommitHook): void {
  afterCommitHook = hook
}
/** An event opts into after-commit dispatch by setting `dispatchAfterCommit = true`. */
function shouldDispatchAfterCommit(value: AnyEvent): boolean {
  return !!value && typeof value === 'object' && value.dispatchAfterCommit === true
}

// ── testing: Event::fake() ────────────────────────────────────────────────────
/** A dispatcher that records events instead of running listeners (for tests). */
export class EventFake extends Dispatcher {
  readonly recorded: { name: string, event: AnyEvent }[] = []

  override async dispatch(event: object | string, payload?: AnyEvent): Promise<unknown[]> {
    const name = typeof event === 'string' ? event : nameOfInstance(event)
    this.recorded.push({ name, event: typeof event === 'string' ? payload : event })
    return []
  }

  override async until(event: object): Promise<unknown> {
    this.recorded.push({ name: nameOfInstance(event), event })
    return null
  }

  /** All recorded dispatches of an event (by class or name). */
  dispatched(key: EventKey): AnyEvent[] {
    const name = keyOf(key)
    return this.recorded.filter(r => r.name === name).map(r => r.event)
  }

  assertDispatched(key: EventKey, times?: number): void {
    const count = this.dispatched(key).length
    if (times === undefined ? count === 0 : count !== times) {
      throw new Error(`Expected "${keyOf(key)}" dispatched ${times ?? '≥1'} time(s), got ${count}.`)
    }
  }

  assertNotDispatched(key: EventKey): void {
    const count = this.dispatched(key).length
    if (count !== 0)
      throw new Error(`Expected "${keyOf(key)}" NOT dispatched, got ${count}.`)
  }
}

/** Swap the default dispatcher for a recording fake; returns it. Call {@link restoreEvents} after. */
export function fakeEvents(): EventFake {
  const fake = new EventFake()
  setDefaultDispatcher(fake)
  return fake
}
/** Restore a previously-captured real dispatcher. */
export function restoreEvents(dispatcher: Dispatcher): void {
  setDefaultDispatcher(dispatcher)
}

// ── process-wide default (set by EventServiceProvider at boot) ──────────────
let defaultDispatcher: Dispatcher | null = null

export function setDefaultDispatcher(d: Dispatcher): void {
  defaultDispatcher = d
}
export function dispatcher(): Dispatcher {
  if (!defaultDispatcher)
    defaultDispatcher = new Dispatcher()
  return defaultDispatcher
}

/** Dispatch an event via the default dispatcher (Laravel's `event()` helper). */
export function event<E extends object>(event: E): Promise<unknown[]>
export function event(name: string, payload?: AnyEvent): Promise<unknown[]>
export function event(event: object | string, payload?: AnyEvent): Promise<unknown[]> {
  return typeof event === 'string'
    ? dispatcher().dispatch(event, payload)
    : dispatcher().dispatch(event)
}

/** Register a listener on the default dispatcher. */
export function listen<E>(evt: EventKey<E>, listener: Listener<E>): void {
  dispatcher().listen(evt, listener)
}
