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
  set: { status?: number | string; headers: Record<string, string> }
  /** Route params (e.g. `:id`). */
  params: Record<string, string | undefined>
  /** Parsed query string. */
  query: Record<string, string | undefined>
  /** Parsed request body (validated shape when a schema is set). */
  body: unknown
  [key: string]: unknown
}

/**
 * A middleware. Implement `handle` — short-circuit by returning a response,
 * or return nothing to continue. Extra route arguments (`throttle:60,1`) arrive
 * as trailing string params.
 */
export abstract class Middleware {
  abstract handle(context: MiddlewareContext, ...args: string[]): unknown
}

export type MiddlewareClass = new () => Middleware
/** A middleware entry: a class, a raw Elysia plugin, or (in groups) an alias name. */
export type MiddlewareItem = MiddlewareClass | Elysia
export type GroupItem = MiddlewareItem | string

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

/** Run one named alias (with optional args) as a before-handle guard. */
async function runAlias(spec: string, context: MiddlewareContext): Promise<unknown> {
  const [name, args] = parseSpec(spec)
  const Cls = aliases.get(name)
  if (!Cls) {
    throw new Error(
      `[elysia-ravel] Unknown middleware "${name}". Register it in config/middleware.ts (aliases).`,
    )
  }
  return new Cls().handle(context, ...args)
}

/**
 * A named base router: `new Elysia()` plus the `middleware` macro, so routes can
 * do `{ middleware: 'auth' }` / `{ middleware: ['auth', 'throttle:60,1'] }`.
 * Use this instead of `new Elysia()` in `routes/` files.
 */
export function route(prefix?: string) {
  // Return type is inferred (not annotated) so the `middleware` macro stays
  // visible to `.get(..., { middleware: '...' })` at call sites.
  return new Elysia(prefix ? { prefix } : {}).macro({
    middleware(names: string | string[]) {
      const list = Array.isArray(names) ? names : [names]
      return {
        // biome-ignore lint/suspicious/noExplicitAny: Elysia infers the ctx type
        beforeHandle: async (context: any) => {
          for (const spec of list) {
            const result = await runAlias(spec, context as MiddlewareContext)
            if (result !== undefined) return result // short-circuit
          }
          return undefined
        },
      }
    },
  })
}

/** Run a mixed list of guards (alias names or middleware classes) in order. */
async function runGuards(guards: (MiddlewareClass | string)[], context: MiddlewareContext) {
  for (const item of guards) {
    const result =
      typeof item === 'string' ? await runAlias(item, context) : await new item().handle(context)
    if (result !== undefined) return result
  }
  return undefined
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
  const guards = items.filter((i): i is MiddlewareClass | string => !isElysia(i))

  // biome-ignore lint/suspicious/noExplicitAny: composing Elysia plugins of varied generics
  let plugin: any = new Elysia({ name: `ravel-group-${name}` })
  for (const p of plugins) plugin = plugin.use(p)
  if (guards.length) {
    plugin = plugin.onBeforeHandle({ as: 'scoped' }, (context: MiddlewareContext) =>
      runGuards(guards, context),
    )
  }
  return plugin as Elysia
}

/**
 * Build the global-middleware plugin (applied to every request by the
 * Application). Class middleware run as global before-handle guards; raw Elysia
 * plugins are mounted directly.
 */
export function globalMiddlewarePlugin(items: MiddlewareItem[]): Elysia {
  const plugins = items.filter(isElysia)
  const guards = items.filter((i): i is MiddlewareClass => !isElysia(i))

  // biome-ignore lint/suspicious/noExplicitAny: composing Elysia plugins of varied generics
  let plugin: any = new Elysia({ name: 'ravel-global-middleware' })
  for (const p of plugins) plugin = plugin.use(p)
  if (guards.length) {
    plugin = plugin.onBeforeHandle({ as: 'global' }, (context: MiddlewareContext) =>
      runGuards(guards, context),
    )
  }
  return plugin as Elysia
}
