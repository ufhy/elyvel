// biome-ignore lint/suspicious/noExplicitAny: events carry arbitrary payload shapes
type AnyEvent = any
type EventClass<E = AnyEvent> = new (...args: any[]) => E
/** Event identifier: a class constructor or a string name. */
export type EventKey<E = AnyEvent> = EventClass<E> | string
/** A listener: a function, or an object/class instance with `handle`. */
export type Listener<E = AnyEvent> =
  | ((event: E, name: string) => unknown | Promise<unknown>)
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
function invoke(listener: Listener, event: AnyEvent, name: string): unknown {
  return typeof listener === 'function' ? listener(event, name) : listener.handle(event, name)
}

/**
 * Event dispatcher, à la Laravel. Register listeners by event class or name,
 * then `dispatch` an event instance (or a name + payload). Listeners run in
 * registration order; `until` stops at the first non-null return.
 */
export class Dispatcher {
  private readonly listeners = new Map<string, Listener[]>()

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
    const results: unknown[] = []
    for (const listener of this.listenersFor(name)) {
      const result = await invoke(listener, value, name)
      if (result !== null && result !== undefined) results.push(result)
    }
    return results
  }

  /** Dispatch until a listener returns a non-null value; returns that value. */
  async until<E extends object>(event: E): Promise<unknown> {
    const name = nameOfInstance(event)
    for (const listener of this.listenersFor(name)) {
      const result = await invoke(listener, event, name)
      if (result !== null && result !== undefined) return result
    }
    return null
  }
}

// ── process-wide default (set by EventServiceProvider at boot) ──────────────
let defaultDispatcher: Dispatcher | null = null

export function setDefaultDispatcher(d: Dispatcher): void {
  defaultDispatcher = d
}
export function dispatcher(): Dispatcher {
  if (!defaultDispatcher) defaultDispatcher = new Dispatcher()
  return defaultDispatcher
}

/** Dispatch an event via the default dispatcher (Laravel's `event()` helper). */
export function event<E extends object>(event: E): Promise<unknown[]>
export function event(name: string, payload?: AnyEvent): Promise<unknown[]>
export function event(event: object | string, payload?: AnyEvent): Promise<unknown[]> {
  return typeof event === 'string' ? dispatcher().dispatch(event, payload) : dispatcher().dispatch(event)
}

/** Register a listener on the default dispatcher. */
export function listen<E>(evt: EventKey<E>, listener: Listener<E>): void {
  dispatcher().listen(evt, listener)
}
