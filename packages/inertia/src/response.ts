import { AsyncLocalStorage } from 'node:async_hooks'

/** A resolved value or a (possibly async) producer of one. */
type PropValue = unknown | (() => unknown | Promise<unknown>)
type Callback = () => unknown | Promise<unknown>

/** A prop only included on partial reloads that explicitly request it (Laravel's `optional`). */
export class OptionalProp {
  constructor(readonly callback: Callback) {}
}
/** A prop always included, even on `only` partial reloads (Laravel's `always`). */
export class AlwaysProp {
  constructor(readonly callback: Callback) {}
}
/** A prop loaded after the initial render (Inertia v2 `defer`); client auto-fetches it. */
export class DeferProp {
  constructor(
    readonly callback: Callback,
    readonly group = 'default',
    readonly rescue = false,
  ) {}
}
/** A prop the client merges into existing data (Inertia v2 `merge`/`deepMerge`). */
export class MergeProp {
  matchOnKeys: string[] = []
  prependMode = false
  constructor(
    readonly value: PropValue,
    readonly deep = false,
  ) {}

  /** Prepend merged items instead of appending. */
  prepend(): this {
    this.prependMode = true
    return this
  }

  /** Keys used to de-duplicate/match items when merging (`posts.id`). */
  matchOn(...keys: string[]): this {
    this.matchOnKeys = keys
    return this
  }
}
/** A prop resolved once and reused across visits (Inertia v2 `once`). */
export class OnceProp {
  constructor(readonly callback: Callback) {}
}

/** The page object sent to the Inertia client. */
export interface Page {
  component: string
  // `errors` is always set (see `buildProps` — session-flashed errors, or `{}`).
  props: Record<string, unknown> & { errors: Record<string, unknown> }
  url: string
  version: string
  // Always present (even if empty) — the Inertia client's own `Page<T>` type
  // requires both. We don't yet implement session flash sharing or
  // client-remembered-state round-tripping, so these are honestly empty
  // rather than fabricated: no flash data / no remembered state on this response.
  flash: Record<string, unknown>
  rememberedState: Record<string, unknown>
  // Always present (even if empty) — matches Inertia's own `Page<T>` shape.
  rescuedProps: string[]
  deferredProps?: Record<string, string[]>
  mergeProps?: string[]
  deepMergeProps?: string[]
  prependProps?: string[]
  matchPropsOn?: string[]
  // No expiry tracking (yet) — each entry is honestly `expiresAt: null` ("never").
  onceProps?: Record<string, { prop: string, expiresAt?: number | null }>
  encryptHistory?: boolean
  clearHistory?: boolean
  preserveFragment?: boolean
}

/** Returned from a handler to render an Inertia page. */
export class InertiaResponse {
  readonly __inertia = 'page' as const
  encryptHistoryFlag = false
  clearHistoryFlag = false
  preserveFragmentFlag = false

  constructor(
    readonly component: string,
    readonly props: Record<string, unknown> = {},
  ) {}

  /** Encrypt this page's history state (Inertia v2). */
  encryptHistory(value = true): this {
    this.encryptHistoryFlag = value
    return this
  }

  /** Clear the client's history state on this visit (e.g. after logout). */
  clearHistory(): this {
    this.clearHistoryFlag = true
    return this
  }

  /** Preserve the URL fragment (#hash) across this visit. */
  preserveFragment(): this {
    this.preserveFragmentFlag = true
    return this
  }
}

/** Returned to force a client-side visit to an external/other URL. */
export class InertiaLocation {
  readonly __inertia = 'location' as const
  constructor(readonly url: string) {}
}

// ── shared props (merged into every page) ─────────────────────────────────────
// `shared` holds props registered outside a request (e.g. a ServiceProvider's
// `boot()`, which — unlike PHP-FPM — runs once at process start, not once per
// request) — these apply as a baseline to every request forever. `requestShared`
// is a fresh Map per request (the `inertia` plugin establishes it via
// `freshSharedScope()` in `onRequest`, before any handler runs), so a
// `Inertia.share('user', ctx.user)` call from within a request (middleware or
// controller) — the idiomatic place to share per-request data like the
// signed-in user — can't leak into or be clobbered by a concurrent request.
const shared = new Map<string, PropValue>()
const requestShared = new AsyncLocalStorage<Map<string, PropValue>>()

function activeSharedStore(): Map<string, PropValue> {
  return requestShared.getStore() ?? shared
}

/**
 * Starts a fresh per-request shared-prop scope for the rest of the current
 * async continuation. The `inertia()` plugin calls this once per request
 * (`onRequest`, before routing) — apps don't need to call it themselves.
 */
export function freshSharedScope(): void {
  requestShared.enterWith(new Map())
}

export const Inertia = {
  render(component: string, props: Record<string, unknown> = {}): InertiaResponse {
    return new InertiaResponse(component, props)
  },
  location(url: string): InertiaLocation {
    return new InertiaLocation(url)
  },
  /**
   * Share a prop merged into every subsequent page render. Called during a
   * request (middleware/controller), it's scoped to THAT request only; called
   * outside one (e.g. `AppServiceProvider.boot()`), it becomes a permanent
   * baseline for every request.
   */
  share(key: string, value: PropValue): void {
    activeSharedStore().set(key, value)
  },
  /** A prop evaluated only when a partial reload requests it. */
  optional(callback: Callback): OptionalProp {
    return new OptionalProp(callback)
  },
  /** A prop always included, even on `only` partial reloads. */
  always(callback: Callback): AlwaysProp {
    return new AlwaysProp(callback)
  },
  /** A prop loaded after first render; the client auto-fetches it (optionally grouped). */
  defer(callback: Callback, group = 'default', options: { rescue?: boolean } = {}): DeferProp {
    return new DeferProp(callback, group, options.rescue ?? false)
  },
  /** A prop the client appends/merges into existing data (infinite scroll etc.). */
  merge(value: PropValue): MergeProp {
    return new MergeProp(value, false)
  },
  /** Like `merge`, but a recursive deep merge. */
  deepMerge(value: PropValue): MergeProp {
    return new MergeProp(value, true)
  },
  /** A prop resolved once and reused across visits. */
  once(callback: Callback): OnceProp {
    return new OnceProp(callback)
  },
  /** Clears the active scope's shares (request-scoped during a request, global otherwise). */
  flushShared(): void {
    activeSharedStore().clear()
  },
}

async function evaluate(value: PropValue): Promise<unknown> {
  return typeof value === 'function' ? await (value as () => unknown)() : value
}

function parseList(header: string | null): string[] {
  return header
    ? header
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    : []
}

/** The props (filtered/evaluated) plus the v2 page-object metadata they imply. */
export interface BuiltProps {
  // `errors` is always set (see below — session-flashed errors, or `{}`).
  props: Record<string, unknown> & { errors: Record<string, unknown> }
  // Always present (even if empty) — matches Inertia's own `Page<T>` shape.
  rescuedProps: string[]
  deferredProps?: Record<string, string[]>
  mergeProps?: string[]
  deepMergeProps?: string[]
  prependProps?: string[]
  matchPropsOn?: string[]
  // No expiry tracking (yet) — each entry is honestly `expiresAt: null` ("never").
  onceProps?: Record<string, { prop: string, expiresAt?: number | null }>
}

/**
 * Merge shared + flashed errors + page props, apply partial-reload filtering,
 * evaluate lazy/optional/always/defer/merge/once props, and collect the v2
 * page-object metadata (deferredProps, mergeProps, …).
 */
export async function buildProps(
  response: InertiaResponse,
  request: Request,
  session: { get(key: string): unknown } | undefined,
): Promise<BuiltProps> {
  const merged: Record<string, PropValue> = {}
  for (const [key, value] of shared) merged[key] = value // global baseline (e.g. app name)
  const scoped = requestShared.getStore()
  if (scoped) {
    for (const [key, value] of scoped) merged[key] = value // this request's own shares win
  }
  merged.errors = (session?.get('errors') as Record<string, unknown>) ?? {}
  Object.assign(merged, response.props)

  const isPartial = request.headers.get('x-inertia-partial-component') === response.component
  const only = isPartial ? parseList(request.headers.get('x-inertia-partial-data')) : []
  const except = isPartial ? parseList(request.headers.get('x-inertia-partial-except')) : []

  const out: Record<string, unknown> = {}
  const deferred: Record<string, string[]> = {}
  const mergeProps: string[] = []
  const deepMergeProps: string[] = []
  const prependProps: string[] = []
  const matchPropsOn: string[] = []
  const onceProps: Record<string, { prop: string, expiresAt?: number | null }> = {}
  const rescuedProps: string[] = []

  const excludedByPartial = (key: string, isAlways: boolean) =>
    !isAlways
    && ((only.length > 0 && !only.includes(key)) || (except.length > 0 && except.includes(key)))

  for (const [key, value] of Object.entries(merged)) {
    if (value instanceof DeferProp) {
      // Full visit: don't resolve — advertise it in deferredProps for the client to fetch.
      if (!(isPartial && only.includes(key))) {
        if (!isPartial)
          (deferred[value.group] ??= []).push(key)
        continue
      }
      try {
        out[key] = await evaluate(value.callback)
      }
      catch (error) {
        if (value.rescue)
          rescuedProps.push(key)
        else throw error
      }
      continue
    }

    const isAlways = value instanceof AlwaysProp
    const isOptional = value instanceof OptionalProp
    if (excludedByPartial(key, isAlways))
      continue
    if (isOptional && !(isPartial && only.includes(key)))
      continue

    if (value instanceof MergeProp) {
      out[key] = await evaluate(value.value)
      ;(value.prependMode ? prependProps : value.deep ? deepMergeProps : mergeProps).push(key)
      matchPropsOn.push(...value.matchOnKeys)
    }
    else if (value instanceof OnceProp) {
      out[key] = await evaluate(value.callback)
      onceProps[key] = { prop: key, expiresAt: null }
    }
    else if (isAlways || isOptional) {
      out[key] = await evaluate(value.callback)
    }
    else {
      out[key] = await evaluate(value)
    }
  }

  // Always present — validation errors must survive partial-reload filtering
  // (an `only` list that omits it shouldn't hide the current page's errors).
  out.errors = merged.errors

  const result: BuiltProps = { props: out as BuiltProps['props'], rescuedProps }
  if (Object.keys(deferred).length)
    result.deferredProps = deferred
  if (mergeProps.length)
    result.mergeProps = mergeProps
  if (deepMergeProps.length)
    result.deepMergeProps = deepMergeProps
  if (prependProps.length)
    result.prependProps = prependProps
  if (matchPropsOn.length)
    result.matchPropsOn = matchPropsOn
  if (Object.keys(onceProps).length)
    result.onceProps = onceProps
  return result
}
