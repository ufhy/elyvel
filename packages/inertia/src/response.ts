/** A resolved value or a (possibly async) producer of one. */
type PropValue = unknown | (() => unknown | Promise<unknown>)

/** A prop only included on partial reloads that explicitly request it (Laravel's `optional`). */
export class OptionalProp {
  constructor(readonly callback: () => unknown | Promise<unknown>) {}
}
/** A prop always included, even on `only` partial reloads (Laravel's `always`). */
export class AlwaysProp {
  constructor(readonly callback: () => unknown | Promise<unknown>) {}
}

/** The page object sent to the Inertia client. */
export interface Page {
  component: string
  props: Record<string, unknown>
  url: string
  version: string
}

/** Returned from a handler to render an Inertia page. */
export class InertiaResponse {
  readonly __inertia = 'page' as const
  constructor(
    readonly component: string,
    readonly props: Record<string, unknown> = {},
  ) {}
}

/** Returned to force a client-side visit to an external/other URL. */
export class InertiaLocation {
  readonly __inertia = 'location' as const
  constructor(readonly url: string) {}
}

// ── shared props (merged into every page) ─────────────────────────────────────
const shared = new Map<string, PropValue>()

export const Inertia = {
  /** Render an Inertia page component with props. */
  render(component: string, props: Record<string, unknown> = {}): InertiaResponse {
    return new InertiaResponse(component, props)
  },
  /** Force the client to visit a URL (full reload for external links). */
  location(url: string): InertiaLocation {
    return new InertiaLocation(url)
  },
  /** Share a prop into every page (e.g. the authenticated user, flash). */
  share(key: string, value: PropValue): void {
    shared.set(key, value)
  },
  /** A prop evaluated only when a partial reload requests it. */
  optional(callback: () => unknown | Promise<unknown>): OptionalProp {
    return new OptionalProp(callback)
  },
  /** A prop always included, even on `only` partial reloads. */
  always(callback: () => unknown | Promise<unknown>): AlwaysProp {
    return new AlwaysProp(callback)
  },
  /** Clear shared props (mainly for tests). */
  flushShared(): void {
    shared.clear()
  },
}

async function evaluate(value: PropValue): Promise<unknown> {
  return typeof value === 'function' ? await (value as () => unknown)() : value
}

const parseList = (header: string | null): string[] =>
  header
    ? header
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : []

/**
 * Merge shared + flashed errors + page props, then apply partial-reload filtering
 * (`X-Inertia-Partial-Data` / `-Except`) and evaluate lazy/optional/always props.
 */
export async function buildProps(
  response: InertiaResponse,
  request: Request,
  session: { get(key: string): unknown } | undefined,
): Promise<Record<string, unknown>> {
  const merged: Record<string, PropValue> = {}
  for (const [key, value] of shared) merged[key] = value
  // Validation errors flashed on redirect-back — Inertia reads `page.props.errors`.
  merged.errors = (session?.get('errors') as Record<string, unknown>) ?? {}
  Object.assign(merged, response.props)

  const isPartial = request.headers.get('x-inertia-partial-component') === response.component
  const only = isPartial ? parseList(request.headers.get('x-inertia-partial-data')) : []
  const except = isPartial ? parseList(request.headers.get('x-inertia-partial-except')) : []

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(merged)) {
    const isAlways = value instanceof AlwaysProp
    const isOptional = value instanceof OptionalProp

    if (!isAlways) {
      if (only.length > 0 && !only.includes(key)) continue
      if (except.length > 0 && except.includes(key)) continue
      // optional props are excluded unless a partial reload explicitly asks for them
      if (isOptional && !(isPartial && only.includes(key))) continue
    }

    if (isAlways || isOptional) out[key] = await evaluate(value.callback)
    else out[key] = await evaluate(value)
  }
  return out
}
