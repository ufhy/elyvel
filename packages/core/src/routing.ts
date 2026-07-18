import type { MiddlewareContext } from './middleware'
import { trans } from '@elyvel/support'
import { Elysia } from 'elysia'
import { route } from './middleware'
import { named } from './url'

/** A controller action handler — receives the Elysia context, returns a response. */
export type RouteHandler = (context: MiddlewareContext) => unknown

/**
 * Base class for controllers. Extend it and define RESTful methods
 * (`index`, `create`, `store`, `show`, `edit`, `update`, `destroy`); wire them
 * up with {@link resource} or {@link apiResource}. Plain classes work too —
 * the base is just for familiarity.
 */
export abstract class Controller {}

/** The seven RESTful resource actions, à la Laravel's `Route::resource`. */
export type ResourceAction = 'index' | 'create' | 'store' | 'show' | 'edit' | 'update' | 'destroy'

const ALL_ACTIONS: ResourceAction[] = ['index', 'create', 'store', 'show', 'edit', 'update', 'destroy']

/** `create`/`edit` render forms (e.g. an Inertia page) — not meaningful for a JSON API. */
const API_ACTIONS: ResourceAction[] = ALL_ACTIONS.filter(a => a !== 'create' && a !== 'edit')

/** Resolves the route id into a model instance (e.g. an Eloquent model class). */
export interface ModelBinder {
  find(id: unknown): unknown | Promise<unknown>
}
export type Binder = ModelBinder | ((id: string) => unknown | Promise<unknown>)

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
  /**
   * Route model binding: resolve `:id` into a model for `show`/`update`/`destroy`,
   * exposed as `ctx.model` (404 if not found). Pass a model class with a static
   * `find(id)` (like an Eloquent model) or a resolver function.
   */
  bind?: Binder
  /**
   * Register named routes (`<name>.index`, `.show`, …) for {@link urlFor}. Templates
   * are relative to `path`, so include any parent prefix in `path` for full URLs.
   */
  name?: string
  /**
   * Handler run when route model binding finds nothing (instead of the default
   * 404). Return a response.
   */
  onMissing?: RouteHandler
}

type ControllerInstance = Partial<Record<ResourceAction, RouteHandler>>
export type ControllerClass = new () => ControllerInstance

function selectedActions(options: ResourceOptions, base: ResourceAction[]): ResourceAction[] {
  if (options.only)
    return base.filter(a => options.only?.includes(a))
  if (options.except)
    return base.filter(a => !options.except?.includes(a))
  return base
}

function middlewareFor(action: ResourceAction, options: ResourceOptions): string[] {
  const mw = options.middleware
  if (!mw)
    return []
  return Array.isArray(mw) ? mw : (mw[action] ?? [])
}

/**
 * Register RESTful routes for a controller, à la Laravel's `Route::resource`:
 *
 * | Verb        | Path          | Action    |
 * |-------------|---------------|-----------|
 * | GET         | `/`           | `index`   |
 * | GET         | `/create`     | `create`  |
 * | POST        | `/`           | `store`   |
 * | GET         | `/:id`        | `show`    |
 * | GET         | `/:id/edit`   | `edit`    |
 * | PUT / PATCH | `/:id`        | `update`  |
 * | DELETE      | `/:id`        | `destroy` |
 *
 * `create`/`edit` are meant for rendering a form (e.g. `Inertia.render(...)`)
 * — for a JSON-only API, use {@link apiResource} instead. Only actions the
 * controller actually defines are wired. Returns an Elysia plugin —
 * default-export it from a `routes/` file or compose with `.use()`.
 */
export function resource(
  path: string,
  Controller: ControllerClass,
  options: ResourceOptions = {},
): Elysia {
  return buildResource(path, Controller, options, ALL_ACTIONS)
}

/**
 * Register RESTful **JSON API** routes for a controller, à la Laravel's
 * `Route::apiResource` — like {@link resource}, but without `create`/`edit`
 * (which render forms, not meaningful for a JSON API):
 *
 * | Verb        | Path        | Action    |
 * |-------------|-------------|-----------|
 * | GET         | `/`         | `index`   |
 * | POST        | `/`         | `store`   |
 * | GET         | `/:id`      | `show`    |
 * | PUT / PATCH | `/:id`      | `update`  |
 * | DELETE      | `/:id`      | `destroy` |
 */
export function apiResource(
  path: string,
  Controller: ControllerClass,
  options: ResourceOptions = {},
): Elysia {
  return buildResource(path, Controller, options, API_ACTIONS)
}

function buildResource(
  path: string,
  Controller: ControllerClass,
  options: ResourceOptions,
  base: ResourceAction[],
): Elysia {
  const instance = new Controller()
  const param = options.param ?? 'id'
  const idPath = `/:${param}`
  const label = path.replace(/^\//, '').replace(/\/$/, '') || 'resource'
  let r: any = route(path)

  const opts = (action: ResourceAction) => {
    const mw = middlewareFor(action, options)
    return mw.length ? { middleware: mw } : undefined
  }

  const resolveModel = async (ctx: MiddlewareContext): Promise<unknown> => {
    const id = ctx.params[param]
    const binder = options.bind as Binder
    // A model class (or object) exposes `.find`; anything else is a resolver fn.
    return typeof (binder as ModelBinder).find === 'function'
      ? (binder as ModelBinder).find(id)
      : (binder as (id: string) => unknown)(String(id))
  }

  // Wrap id-based actions with model binding when `bind` is set.
  const bindAction = (action: ResourceAction, handler: RouteHandler): RouteHandler => {
    const needsModel = action === 'show' || action === 'edit' || action === 'update' || action === 'destroy'
    if (!options.bind || !needsModel)
      return handler
    return async (ctx) => {
      const model = await resolveModel(ctx)
      if (model === null || model === undefined) {
        return options.onMissing
          ? options.onMissing(ctx)
          : ctx.status(404, { message: trans('errors.not_found', { resource: label }, `${label} not found`) })
      }
      ctx.model = model
      return handler(ctx)
    }
  }

  const bind = (action: ResourceAction): RouteHandler | undefined => {
    const fn = instance[action]
    if (typeof fn !== 'function')
      return undefined
    return bindAction(action, (fn as RouteHandler).bind(instance))
  }

  const fullPath = (suffix: string) => `${path}${suffix}`.replace(/\/$/, '') || '/'
  const nameRoute = (action: ResourceAction, suffix: string) => {
    if (options.name)
      named(`${options.name}.${action}`, fullPath(suffix))
  }

  for (const action of selectedActions(options, base)) {
    const handler = bind(action)
    if (!handler)
      continue
    switch (action) {
      case 'index':
        r = r.get('/', handler, opts(action))
        nameRoute(action, '')
        break
      case 'create':
        // Registered before `/:id` so it isn't swallowed by the id route.
        r = r.get('/create', handler, opts(action))
        nameRoute(action, '/create')
        break
      case 'store':
        r = r.post('/', handler, opts(action))
        nameRoute(action, '')
        break
      case 'show':
        r = r.get(idPath, handler, opts(action))
        nameRoute(action, idPath)
        break
      case 'edit':
        r = r.get(`${idPath}/edit`, handler, opts(action))
        nameRoute(action, `${idPath}/edit`)
        break
      case 'update':
        r = r.put(idPath, handler, opts(action)).patch(idPath, handler, opts(action))
        nameRoute(action, idPath)
        break
      case 'destroy':
        r = r.delete(idPath, handler, opts(action))
        nameRoute(action, idPath)
        break
    }
  }
  return r as Elysia
}

/** Singleton resource actions (no `:id` — one instance per context, e.g. `/profile`). */
export type SingletonAction = 'show' | 'update' | 'destroy' | 'store'

export interface SingletonOptions {
  only?: SingletonAction[]
  except?: SingletonAction[]
  /** Add a `store` route (POST /) — a "creatable" singleton. */
  creatable?: boolean
  middleware?: string[] | Partial<Record<SingletonAction, string[]>>
  name?: string
}

/**
 * Register a singleton resource, à la Laravel's `Route::singleton` — a resource
 * with no id (one instance per context, like `/profile` or `/settings`):
 *
 * | Verb        | Path | Action    |
 * |-------------|------|-----------|
 * | GET         | `/`  | `show`    |
 * | PUT / PATCH | `/`  | `update`  |
 * | DELETE      | `/`  | `destroy` |
 * | POST        | `/`  | `store`   | (only when `creatable`)
 *
 * The controller resolves the single instance itself (e.g. from `ctx.user`).
 */
export function singleton(
  path: string,
  Controller: ControllerClass,
  options: SingletonOptions = {},
): Elysia {
  const instance = new Controller()
  const all: SingletonAction[] = options.creatable
    ? ['store', 'show', 'update', 'destroy']
    : ['show', 'update', 'destroy']
  const actions = options.only
    ? all.filter(a => options.only?.includes(a))
    : options.except
      ? all.filter(a => !options.except?.includes(a))
      : all

  let r: any = route(path)
  const mwOf = (action: SingletonAction) => {
    const mw = options.middleware
    const list = !mw ? [] : Array.isArray(mw) ? mw : (mw[action] ?? [])
    return list.length ? { middleware: list } : undefined
  }
  const bind = (action: SingletonAction): RouteHandler | undefined => {
    const fn = (instance as Record<string, unknown>)[action]
    return typeof fn === 'function' ? (fn as RouteHandler).bind(instance) : undefined
  }
  const nameRoute = (action: SingletonAction) => {
    if (options.name)
      named(`${options.name}.${action}`, path.replace(/\/$/, '') || '/')
  }

  for (const action of actions) {
    const handler = bind(action)
    if (!handler)
      continue
    switch (action) {
      case 'store':
        r = r.post('/', handler, mwOf(action))
        break
      case 'show':
        r = r.get('/', handler, mwOf(action))
        break
      case 'update':
        r = r.put('/', handler, mwOf(action)).patch('/', handler, mwOf(action))
        break
      case 'destroy':
        r = r.delete('/', handler, mwOf(action))
        break
    }
    nameRoute(action)
  }
  return r as Elysia
}

/** A single-action (invokable) controller: defines `handle` (or `__invoke`). */
export type InvokableClass = new () => {
  handle?: RouteHandler
  __invoke?: RouteHandler
}

/**
 * Turn an invokable controller into a route handler, à la Laravel's single-action
 * controllers: `route().post('/provision', invoke(ProvisionServer))`.
 */
export function invoke(Controller: InvokableClass): RouteHandler {
  const instance = new Controller()
  const fn = instance.handle ?? instance.__invoke
  if (typeof fn !== 'function') {
    throw new TypeError(`[elyvel] ${Controller.name} must define handle() or __invoke().`)
  }
  return ctx => fn.call(instance, ctx)
}

/**
 * A fallback handler for unmatched routes, à la Laravel's `Route::fallback`.
 * Default-export it from a `routes/` file (loaded last) or `.use()` it on the
 * root. Runs whenever no other route matches.
 */
export function fallback(handler: RouteHandler): Elysia {
  const plugin: any = new Elysia({ name: 'elyvel-fallback' }).onError({ as: 'global' }, (ctx) => {
    if (ctx.code === 'NOT_FOUND')
      return handler(ctx as unknown as MiddlewareContext)
  })
  return plugin as Elysia
}
