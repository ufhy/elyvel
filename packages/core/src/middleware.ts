import { Elysia } from 'elysia'

/**
 * The request context handed to a middleware. It's the Elysia context, so you
 * get `request`, `set`, `status(...)`, plus anything earlier middleware/plugins
 * derived (e.g. `user`). Return a value (like `status(401, ...)`) to stop the
 * request; return nothing to let it continue — just like Laravel's `handle`.
 */
export interface MiddlewareContext {
  request: Request
  status: (code: number, body?: unknown) => unknown
  set: { status?: number | string; headers: Record<string, string | number> }
  /** Route params (e.g. `:id`). */
  params: Record<string, string | undefined>
  /** Parsed query string. */
  query: Record<string, string | undefined>
  /** Parsed request body (validated shape when a schema is set). */
  body: unknown
  [key: string]: unknown
}

/**
 * A middleware. Implement `handle` (runs before the route) — short-circuit by
 * returning a response, or return nothing to continue. Optionally implement
 * `terminate` to run work *after* the response is sent (logging, cleanup).
 * Extra route arguments (`throttle:60,1`) arrive as trailing string params.
 */
export abstract class Middleware {
  abstract handle(context: MiddlewareContext, ...args: string[]): unknown
  /** Runs after the response is sent. Return value is ignored. */
  terminate?(context: MiddlewareContext, ...args: string[]): void | Promise<void>
}

export type MiddlewareClass = new () => Middleware
/** A middleware entry: a class, a raw Elysia plugin, or (in groups) an alias name. */
export type MiddlewareItem = MiddlewareClass | Elysia
export type GroupItem = MiddlewareItem | string
/** A "guard" — a middleware class or an alias spec string like `throttle:60,1`. */
type Guard = MiddlewareClass | string

/** Shape of `config/middleware.ts`. Author it with {@link defineMiddlewareConfig}. */
export interface MiddlewareConfig {
  /** Runs on every request, in order. */
  global?: MiddlewareItem[]
  /** Named middleware assignable per-route: `{ middleware: 'auth' }`. */
  aliases?: Record<string, MiddlewareClass>
  /** Named bundles applied with `.use(group('web'))`; may reference aliases by name. */
  groups?: Record<string, GroupItem[]>
}

export function defineMiddlewareConfig(config: MiddlewareConfig): MiddlewareConfig {
  return config
}

// ── module-level registries, populated once at boot ─────────────────────────
const aliases = new Map<string, MiddlewareClass>()
const groups = new Map<string, GroupItem[]>()

/** Wire the alias/group registries from config (called by the Application at boot). */
export function registerMiddlewareRegistry(config: MiddlewareConfig): void {
  aliases.clear()
  groups.clear()
  for (const [name, cls] of Object.entries(config.aliases ?? {})) aliases.set(name, cls)
  for (const [name, items] of Object.entries(config.groups ?? {})) groups.set(name, items)
}

function isElysia(value: unknown): value is Elysia {
  return value instanceof Elysia
}

/** Parse `"throttle:60,1"` → `["throttle", ["60", "1"]]`. */
function parseSpec(spec: string): [string, string[]] {
  const idx = spec.indexOf(':')
  if (idx === -1) return [spec, []]
  return [spec.slice(0, idx), spec.slice(idx + 1).split(',')]
}

/** Instantiate a guard (alias name → registered class, or a class as-is). */
function instantiate(guard: Guard): { instance: Middleware; args: string[] } {
  if (typeof guard !== 'string') return { instance: new guard(), args: [] }
  const [name, args] = parseSpec(guard)
  const Cls = aliases.get(name)
  if (!Cls) {
    throw new Error(
      `[elysia-ravel] Unknown middleware "${name}". Register it in config/middleware.ts (aliases).`,
    )
  }
  return { instance: new Cls(), args }
}

/** Run guards' `handle` in order; the first response short-circuits. */
async function runGuards(guards: Guard[], context: MiddlewareContext): Promise<unknown> {
  for (const guard of guards) {
    const { instance, args } = instantiate(guard)
    const result = await instance.handle(context, ...args)
    if (result !== undefined) return result
  }
  return undefined
}

/**
 * Run guards' `terminate` after the response (no short-circuit). Unknown aliases
 * are skipped here — they've already surfaced in the before phase — so a bad
 * config never throws twice.
 */
async function runTerminators(guards: Guard[], context: MiddlewareContext): Promise<void> {
  for (const guard of guards) {
    let resolved: { instance: Middleware; args: string[] }
    try {
      resolved = instantiate(guard)
    } catch {
      continue
    }
    if (resolved.instance.terminate) await resolved.instance.terminate(context, ...resolved.args)
  }
}

/**
 * A named base router: `new Elysia()` plus the `middleware` macro, so routes can
 * do `{ middleware: 'auth' }` / `{ middleware: ['auth', 'throttle:60,1'] }`.
 * Use this instead of `new Elysia()` in `routes/` files.
 *
 * Pass `{ middleware }` to apply middleware to *every* route in this group,
 * à la Laravel's `Route::group(['middleware' => ...])`.
 */
export function route(prefix?: string, options: { middleware?: string[] } = {}) {
  const groupMw = options.middleware ?? []
  // The before hooks short-circuit at runtime by returning the guard's response,
  // but are typed `=> Promise<void>` so Elysia (and therefore Eden) does NOT fold
  // that response into every route's response type — keeping end-to-end types clean.
  type Hook = (context: any) => Promise<void>
  const base = new Elysia(prefix ? { prefix } : {}).macro({
    middleware(names: string | string[]) {
      const list = Array.isArray(names) ? names : [names]
      return {
        beforeHandle: (async (context) => {
          const result = await runGuards(list, context as MiddlewareContext)
          if (result !== undefined) return result
        }) as Hook,
        afterResponse: (async (context) => {
          await runTerminators(list, context as MiddlewareContext)
        }) as Hook,
      }
    },
  })

  // Group-wide middleware hooks (only meaningful when there IS group middleware).
  return base
    .onBeforeHandle({ as: 'scoped' }, (async (context) => {
      if (!groupMw.length) return
      const result = await runGuards(groupMw, context as MiddlewareContext)
      if (result !== undefined) return result
    }) as Hook)
    .onAfterResponse({ as: 'scoped' }, (async (context) => {
      if (groupMw.length) await runTerminators(groupMw, context as MiddlewareContext)
    }) as Hook)
}

/**
 * A middleware group as a `.use()`-able plugin: `route('/api').use(group('web'))`.
 * Group entries may be middleware classes, raw Elysia plugins, or alias names.
 */
export function group(name: string): Elysia {
  const items = groups.get(name)
  if (!items) {
    throw new Error(`[elysia-ravel] Unknown middleware group "${name}" (config/middleware.ts).`)
  }
  const plugins = items.filter(isElysia)
  const guards = items.filter((i): i is Guard => !isElysia(i))

  let plugin: any = new Elysia({ name: `ravel-group-${name}` })
  for (const p of plugins) plugin = plugin.use(p)
  if (guards.length) {
    plugin = plugin
      .onBeforeHandle({ as: 'scoped' }, async (context: MiddlewareContext) => {
        const result = await runGuards(guards, context)
        if (result !== undefined) return result
      })
      .onAfterResponse({ as: 'scoped' }, async (context: MiddlewareContext) => {
        await runTerminators(guards, context)
      })
  }
  return plugin as Elysia
}

/**
 * Build the global-middleware plugin (applied to every request by the
 * Application). Class middleware run as global before/after guards; raw Elysia
 * plugins are mounted directly.
 */
export function globalMiddlewarePlugin(items: MiddlewareItem[]): Elysia {
  const plugins = items.filter(isElysia)
  const guards = items.filter((i): i is MiddlewareClass => !isElysia(i))

  let plugin: any = new Elysia({ name: 'ravel-global-middleware' })
  for (const p of plugins) plugin = plugin.use(p)
  if (guards.length) {
    plugin = plugin
      .onBeforeHandle({ as: 'global' }, async (context: MiddlewareContext) => {
        const result = await runGuards(guards, context)
        if (result !== undefined) return result
      })
      .onAfterResponse({ as: 'global' }, async (context: MiddlewareContext) => {
        await runTerminators(guards, context)
      })
  }
  return plugin as Elysia
}
