import type { Elysia } from 'elysia'
import type { MiddlewareContext } from './middleware'
import { route } from './middleware'

/** A controller action handler — receives the Elysia context, returns a response. */
export type RouteHandler = (context: MiddlewareContext) => unknown

/**
 * Base class for controllers. Extend it and define RESTful methods
 * (`index`, `store`, `show`, `update`, `destroy`); wire them up with
 * {@link resource}. Plain classes work too — the base is just for familiarity.
 */
export abstract class Controller {}

/** The five RESTful resource actions (API-style: no HTML `create`/`edit` forms). */
export type ResourceAction = 'index' | 'store' | 'show' | 'update' | 'destroy'

const ALL_ACTIONS: ResourceAction[] = ['index', 'store', 'show', 'update', 'destroy']

export interface ResourceOptions {
  /** Only wire these actions. */
  only?: ResourceAction[]
  /** Wire every action except these. */
  except?: ResourceAction[]
  /** Route parameter name for the id (default `id`). */
  param?: string
  /**
   * Middleware to apply. An array applies to every action; an object applies
   * per-action. Values are alias specs (`'auth'`, `'throttle:60,1'`).
   */
  middleware?: string[] | Partial<Record<ResourceAction, string[]>>
}

type ControllerInstance = Partial<Record<ResourceAction, RouteHandler>>
export type ControllerClass = new () => ControllerInstance

function selectedActions(options: ResourceOptions): ResourceAction[] {
  if (options.only) return ALL_ACTIONS.filter((a) => options.only?.includes(a))
  if (options.except) return ALL_ACTIONS.filter((a) => !options.except?.includes(a))
  return ALL_ACTIONS
}

function middlewareFor(action: ResourceAction, options: ResourceOptions): string[] {
  const mw = options.middleware
  if (!mw) return []
  return Array.isArray(mw) ? mw : (mw[action] ?? [])
}

/**
 * Register RESTful routes for a controller, à la Laravel's `Route::apiResource`:
 *
 * | Verb        | Path        | Action    |
 * |-------------|-------------|-----------|
 * | GET         | `/`         | `index`   |
 * | POST        | `/`         | `store`   |
 * | GET         | `/:id`      | `show`    |
 * | PUT / PATCH | `/:id`      | `update`  |
 * | DELETE      | `/:id`      | `destroy` |
 *
 * Only actions the controller actually defines are wired. Returns an Elysia
 * plugin — default-export it from a `routes/` file or compose with `.use()`.
 */
export function resource(
  path: string,
  Controller: ControllerClass,
  options: ResourceOptions = {},
): Elysia {
  const instance = new Controller()
  const param = options.param ?? 'id'
  const idPath = `/:${param}`
  // biome-ignore lint/suspicious/noExplicitAny: Elysia route generics vary per call
  let r: any = route(path)

  const opts = (action: ResourceAction) => {
    const mw = middlewareFor(action, options)
    return mw.length ? { middleware: mw } : undefined
  }
  const bind = (action: ResourceAction): RouteHandler | undefined => {
    const fn = instance[action]
    return typeof fn === 'function' ? (fn as RouteHandler).bind(instance) : undefined
  }

  for (const action of selectedActions(options)) {
    const handler = bind(action)
    if (!handler) continue
    switch (action) {
      case 'index':
        r = r.get('/', handler, opts(action))
        break
      case 'store':
        r = r.post('/', handler, opts(action))
        break
      case 'show':
        r = r.get(idPath, handler, opts(action))
        break
      case 'update':
        r = r.put(idPath, handler, opts(action)).patch(idPath, handler, opts(action))
        break
      case 'destroy':
        r = r.delete(idPath, handler, opts(action))
        break
    }
  }
  return r as Elysia
}

/** Alias for {@link resource} — mirrors Laravel's `apiResource` naming. */
export const apiResource = resource
