import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Request-scoped context — Laravel's `Context`. Information captured here rides
 * the request's entire async continuation (same AsyncLocalStorage pattern as
 * `actor.ts`), is appended to every log entry written during it, and travels
 * with queued jobs, so a `trace_id` set in a middleware shows up in the log line
 * a worker writes minutes later on another process.
 *
 * The problem it solves: correlating. A request logs in six places across four
 * modules; without shared context each call site must be handed the trace id
 * explicitly, and the one that isn't is always the one you needed.
 *
 * ```ts
 * Context.add('trace_id', crypto.randomUUID())
 * // …anywhere downstream, including a queued job's handle():
 * log.info('charged')            // ⇒ … trace_id=…
 * Context.get('trace_id')
 * ```
 */

interface ContextBox {
  data: Map<string, unknown>
  /** Included when dehydrating and in `allHidden()`, never in log entries. */
  hidden: Map<string, unknown>
}

const store = new AsyncLocalStorage<ContextBox>()

/** The active box, or a detached one so calls outside a scope don't crash. */
function box(): ContextBox {
  return store.getStore() ?? { data: new Map(), hidden: new Map() }
}

/**
 * Open a fresh context for the current async continuation. Called by the
 * request pipeline (synchronously, before any await — `enterWith` after an
 * internal await does not propagate to the awaiting caller on Bun) and by the
 * queue worker around each job.
 */
export function beginContextScope(): void {
  store.enterWith({ data: new Map(), hidden: new Map() })
}

/** Run `fn` inside its own context scope — for jobs, commands, tests. */
export function withContextScope<T>(fn: () => T): T {
  return store.run({ data: new Map(), hidden: new Map() }, fn)
}

/** Serialised context, for handing to another process (a queued job). */
export interface DehydratedContext {
  data: Record<string, unknown>
  hidden: Record<string, unknown>
}

export const Context = {
  /** Add one value, or several at once. */
  add(key: string | Record<string, unknown>, value?: unknown): void {
    if (typeof key === 'string') {
      box().data.set(key, value)
      return
    }
    for (const [k, v] of Object.entries(key)) box().data.set(k, v)
  },

  /** Add only when the key isn't set yet. */
  addIf(key: string, value: unknown): void {
    if (!box().data.has(key))
      box().data.set(key, value)
  },

  get<T = unknown>(key: string): T | undefined {
    return box().data.get(key) as T | undefined
  },

  has(key: string): boolean {
    return box().data.has(key)
  },

  /** A subset, for building a log payload or response by hand. */
  only(keys: string[]): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const key of keys) {
      if (box().data.has(key))
        out[key] = box().data.get(key)
    }
    return out
  },

  all(): Record<string, unknown> {
    return Object.fromEntries(box().data)
  },

  forget(key: string): void {
    box().data.delete(key)
  },

  /** Append to an array under `key`, creating it — Laravel's `Context::push`. */
  push(key: string, ...values: unknown[]): void {
    const current = box().data.get(key)
    const stack = Array.isArray(current) ? current : []
    stack.push(...values)
    box().data.set(key, stack)
  },

  increment(key: string, by = 1): number {
    const next = Number(box().data.get(key) ?? 0) + by
    box().data.set(key, next)
    return next
  },

  decrement(key: string, by = 1): number {
    return this.increment(key, -by)
  },

  /**
   * Hidden values travel with the context (including into queued jobs) but are
   * never appended to log entries — for things a trace needs and a log file
   * must not hold, like an API token the job will use.
   */
  addHidden(key: string, value: unknown): void {
    box().hidden.set(key, value)
  },

  getHidden<T = unknown>(key: string): T | undefined {
    return box().hidden.get(key) as T | undefined
  },

  forgetHidden(key: string): void {
    box().hidden.delete(key)
  },

  /** Everything, for the queue to carry — Laravel's dehydrate/hydrate pair. */
  dehydrate(): DehydratedContext {
    return { data: Object.fromEntries(box().data), hidden: Object.fromEntries(box().hidden) }
  },

  /** Restore a captured context into the CURRENT scope (open one first). */
  hydrate(dehydrated: DehydratedContext): void {
    const b = box()
    for (const [k, v] of Object.entries(dehydrated.data)) b.data.set(k, v)
    for (const [k, v] of Object.entries(dehydrated.hidden)) b.hidden.set(k, v)
  },
}

/**
 * The visible context as a plain object, for the logger to merge into entries.
 * Empty object (not undefined) when nothing is set, so callers can spread it.
 */
export function visibleContext(): Record<string, unknown> {
  const current = store.getStore()
  return current && current.data.size > 0 ? Object.fromEntries(current.data) : {}
}
