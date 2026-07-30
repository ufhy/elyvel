import type { MiddlewareContext } from './middleware'
import { trans } from '@elyvel/support'
import { Elysia } from 'elysia'
import { excludeMiddleware, guardName, route } from './middleware'
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

// Method → its declared middleware/authorize-ability, class → its declared
// middleware — populated immediately when `@UseMiddleware`/`@Authorize` run
// (class-definition time), read back by `resource()`/`apiResource()` below.
const METHOD_MIDDLEWARE = new WeakMap<Function, string[]>()
const CLASS_MIDDLEWARE = new WeakMap<Function, string[]>()
const METHOD_AUTHORIZE = new WeakMap<Function, string>()
const METHOD_WITHOUT_MIDDLEWARE = new WeakMap<Function, string[]>()
const CLASS_WITHOUT_MIDDLEWARE = new WeakMap<Function, string[]>()
const METHOD_FORM_REQUEST = new WeakMap<Function, FormRequestLike>()

/** The shape `@elyvel/validation`'s `FormRequest` satisfies — duck-typed so `@elyvel/core` never depends on `@elyvel/validation`. */
export interface FormRequestLike {
  validate(ctx: MiddlewareContext): Promise<unknown>
}

/** One registered route's middleware/authorize metadata, for `elyvel route:list`. */
export interface RouteMeta {
  method: string
  path: string
  middleware: string[]
  authorize?: string
}
const ROUTE_META: RouteMeta[] = []
/** Every route registered via `resource()`/`apiResource()` so far, with its middleware/authorize metadata. */
export function routeMetaEntries(): readonly RouteMeta[] {
  return ROUTE_META
}

/**
 * Attach middleware to a controller action (Laravel's `#[Middleware]`) — on a
 * method, applies to that action only; on the class, to every action:
 *
 *   class PostController extends Controller {
 *     @UseMiddleware('auth')
 *     async store(ctx: MiddlewareContext) { ... }
 *   }
 *
 * Merged with any `resource(..., { middleware })` passed at the registration
 * site (class, then method, then that option), not replaced by it.
 */
export function UseMiddleware(...names: string[]) {
  return (target: unknown, context: ClassMethodDecoratorContext | ClassDecoratorContext): void => {
    if (context.kind === 'class')
      CLASS_MIDDLEWARE.set(target as Function, names)
    else if (context.kind === 'method')
      METHOD_MIDDLEWARE.set(target as Function, names)
  }
}

/**
 * Auto-validate a controller action against a `@elyvel/validation` `FormRequest`
 * (Laravel's type-hinted-FormRequest auto-validation) — runs before the action,
 * exposing the validated data as `ctx.validated` instead of an explicit
 * `await SomeRequest.validate(ctx)` call in the method body:
 *
 *   class PostController extends Controller {
 *     @ValidateWith(StorePostRequest)
 *     async store(ctx: MiddlewareContext) {
 *       return Post.create(ctx.validated as Attributes) // already validated
 *     }
 *   }
 *
 * Throws the same way a manual `.validate(ctx)` call would (403/422) — handled
 * by the app's normal exception handling, nothing new to configure.
 */
export function ValidateWith(FormRequestClass: FormRequestLike) {
  return (target: RouteHandler, context: ClassMethodDecoratorContext): void => {
    METHOD_FORM_REQUEST.set(target as unknown as Function, FormRequestClass)
    void context
  }
}

/**
 * Exclude middleware from a controller action (Laravel's `#[WithoutMiddleware]`)
 * — subtracts from whatever `@UseMiddleware`/class-level middleware/
 * `resource({ middleware })` would otherwise apply, on a method or the whole class:
 *
 *   @UseMiddleware('auth', 'subscribed')
 *   class PostController extends Controller {
 *     @WithoutMiddleware('subscribed')
 *     async index(ctx: MiddlewareContext) { ... } // only 'auth' applies here
 *   }
 */
export function WithoutMiddleware(...names: string[]) {
  return (target: unknown, context: ClassMethodDecoratorContext | ClassDecoratorContext): void => {
    if (context.kind === 'class')
      CLASS_WITHOUT_MIDDLEWARE.set(target as Function, names)
    else if (context.kind === 'method')
      METHOD_WITHOUT_MIDDLEWARE.set(target as Function, names)
  }
}

/**
 * Authorize a controller action (Laravel's `#[Authorize]`) — runs `ctx.authorize`
 * (injected by the auth package's middleware, same convention a hand-written
 * `authorize(ctx, ability, ctx.model)` helper uses) before the action, passing
 * `ctx.model` when the action is route-model-bound:
 *
 *   class PostController extends Controller {
 *     @Authorize('update')
 *     async update(ctx: MiddlewareContext) { ... } // ctx.model already resolved
 *   }
 */
export function Authorize(ability: string) {
  return (target: RouteHandler, context: ClassMethodDecoratorContext): void => {
    METHOD_AUTHORIZE.set(target as unknown as Function, ability)
    void context
  }
}

/** Laravel's conventional resource-action → policy-ability mapping. */
const RESOURCE_ABILITY: Partial<Record<ResourceAction, string>> = {
  index: 'viewAny',
  show: 'view',
  create: 'create',
  store: 'create',
  edit: 'update',
  update: 'update',
  destroy: 'delete',
}

/**
 * Auto-wire every resource action to its conventional policy ability (Laravel's
 * `$this->authorizeResource()`) — index→viewAny, show→view, create/store→create,
 * edit/update→update, destroy→delete — instead of a `@Authorize` on each method:
 *
 *   authorizeResource(PostController)
 *   export default resource('/posts', PostController, { bind: Post })
 *
 * An explicit `@Authorize` on a specific method always wins over this default.
 */
export function authorizeResource(Controller: ControllerClass): void {
  const proto = Controller.prototype as Record<string, unknown>
  for (const [action, ability] of Object.entries(RESOURCE_ABILITY)) {
    const fn = proto[action]
    if (typeof fn === 'function' && !METHOD_AUTHORIZE.has(fn))
      METHOD_AUTHORIZE.set(fn, ability)
  }
}

/** The seven RESTful resource actions, à la Laravel's `Route::resource`. */
export type ResourceAction = 'index' | 'create' | 'store' | 'show' | 'edit' | 'update' | 'destroy'

const ALL_ACTIONS: ResourceAction[] = ['index', 'create', 'store', 'show', 'edit', 'update', 'destroy']

/** `create`/`edit` render forms (e.g. an Inertia page) — not meaningful for a JSON API. */
const API_ACTIONS: ResourceAction[] = ALL_ACTIONS.filter(a => a !== 'create' && a !== 'edit')

/**
 * Resolves the route id into a model instance (e.g. an Eloquent model class).
 * `find(id)` binds by primary key; a model may also expose `resolveRouteBinding`
 * to own its lookup (bind by a custom field, apply scopes — Laravel's
 * `resolveRouteBinding`), which the binder prefers when present.
 */
export interface ModelBinder {
  find(id: unknown): unknown | Promise<unknown>
  resolveRouteBinding?(value: unknown, field?: string): unknown | Promise<unknown>
  /** Like `find`, but also matches soft-deleted rows — used when `ResourceOptions.withTrashed` applies. */
  findWithTrashed?(id: unknown): unknown | Promise<unknown>
  /** Like `resolveRouteBinding`, but also matches soft-deleted rows. */
  resolveRouteBindingWithTrashed?(value: unknown, field?: string): unknown | Promise<unknown>
}
export type Binder = ModelBinder | ((id: string) => unknown | Promise<unknown>)

export interface ResourceOptions {
  /** Only wire these actions. */
  only?: ResourceAction[]
  /** Wire every action except these. */
  except?: ResourceAction[]
  /**
   * Route parameter name for the id (default `id`).
   *
   * Matters when nesting resources under the same parent path: Elysia's
   * router rejects two differently-named dynamic segments at the same tree
   * depth. `resource('/posts', PostController)` composed with
   * `resource('/:post/comments', CommentController)` (via `.use()`) collide
   * unless the parent's own id param is ALSO named `post`
   * (`{ param: 'post' }`) — both trees must agree on the segment name.
   */
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
   * Allow soft-deleted rows to resolve via route model binding (Laravel's
   * `->withTrashed()`) — `true` applies to `show`/`edit`/`update` (matching
   * Laravel's default), or name a subset of actions explicitly. Needs the
   * bound model to implement `findWithTrashed`/`resolveRouteBindingWithTrashed`
   * (elyvel's own `Model` does) — a no-op otherwise.
   */
  withTrashed?: boolean | ResourceAction[]
  /**
   * Bind by this column instead of the primary key (Laravel's `/posts/{post:slug}`).
   * Needs the bound model to expose `resolveRouteBinding(value, field)` (Eloquent
   * models do); ignored by a plain resolver function or a `find`-only binder.
   */
  bindField?: string
  /**
   * Laravel's `->scoped()` — verify the bound child actually belongs to a
   * parent route param, instead of resolving the child by its own id alone.
   * Key: the parent's route param name; value: the column on the bound model
   * that must match it. 404s (or `onMissing`) when it doesn't:
   *
   *   resource('/photos/:photo/comments', CommentController, {
   *     bind: Comment,
   *     scoped: { photo: 'photo_id' },
   *   })
   *   // GET /photos/1/comments/5 → 404 unless the found Comment#5's
   *   // photo_id equals 1 — no more hand-rolled ownership checks per action.
   */
  scoped?: Record<string, string>
  /**
   * Register named routes (`<name>.index`, `.show`, …) for {@link urlFor}. Templates
   * are relative to `path`, so include any parent prefix in `path` for full URLs.
   */
  name?: string
  /**
   * Override the registered name for specific actions (Laravel's `->names()`),
   * instead of the uniform `<name>.<action>` every action gets by default:
   *
   *   resource('/photos', PhotoController, { name: 'photos', names: { create: 'photos.build' } })
   *   // create → 'photos.build'; every other action → 'photos.<action>' as usual
   *
   * Works even without `name` set at all — an action present here always uses
   * its override.
   */
  names?: Partial<Record<ResourceAction, string>>
  /**
   * Handler run when route model binding finds nothing (instead of the default
   * 404). Return a response.
   */
  onMissing?: RouteHandler
  /**
   * Laravel's `->shallow()` — for a nested resource, keep the collection
   * actions (`index`/`create`/`store`) under the full nested `path`, but move
   * the member actions (`show`/`edit`/`update`/`destroy`, which already carry
   * a unique id) to a flat `/<resource>/:id` path instead of repeating the
   * parent segment:
   *
   *   resource('/photos/:photo/comments', CommentController, { shallow: true })
   *   // index/create/store → /photos/:photo/comments
   *   // show/edit/update/destroy → /comments/:id
   */
  shallow?: boolean
}

/**
 * The `Elysia` plugin `resource()`/`apiResource()` return, plus Laravel's
 * fluent post-registration middleware adjustment (`->middleware()`,
 * `->middlewareFor()`, `->withoutMiddlewareFor()`).
 */
// An intersection (not `interface X extends Elysia`) — extending the heavily
// generic `Elysia` class via a plain interface pins its type params to
// defaults, which then fails structural checks against a real, richer Elysia
// instance (e.g. `route()`'s macro-augmented one) at `.use()` call sites.
export type ResourceRoute = Elysia & {
  middleware(names: string | string[]): ResourceRoute
  middlewareFor(actions: ResourceAction | ResourceAction[], names: string | string[]): ResourceRoute
  withoutMiddlewareFor(actions: ResourceAction | ResourceAction[], names: string | string[]): ResourceRoute
}

/** The last non-dynamic path segment — `/photos/:photo/comments` → `comments`. */
function lastStaticSegment(path: string): string {
  const parts = path.split('/').filter(Boolean)
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!parts[i]!.startsWith(':'))
      return parts[i]!
  }
  return path.replace(/^\/+/, '') || 'resource'
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

function middlewareFor(
  action: ResourceAction,
  options: ResourceOptions,
  Controller: ControllerClass,
  fn: RouteHandler | undefined,
): string[] {
  const classMw = CLASS_MIDDLEWARE.get(Controller) ?? []
  const methodMw = fn ? (METHOD_MIDDLEWARE.get(fn) ?? []) : []
  const mw = options.middleware
  const explicit = !mw ? [] : Array.isArray(mw) ? mw : (mw[action] ?? [])
  const merged = [...classMw, ...methodMw, ...explicit]

  const without = withoutNames(Controller, fn)
  // Compare by alias NAME, not the whole spec: an exact-string match meant
  // `@WithoutMiddleware('throttle')` silently failed to drop `'throttle:60,1'`,
  // leaving the middleware in place on a route that had asked to be exempt.
  return without.size ? merged.filter(spec => !without.has(guardName(spec))) : merged
}

/** Every middleware name this controller/action opted out of. */
function withoutNames(Controller: ControllerClass, fn: RouteHandler | undefined): Set<string> {
  return new Set([
    ...(CLASS_WITHOUT_MIDDLEWARE.get(Controller) ?? []),
    ...(fn ? (METHOD_WITHOUT_MIDDLEWARE.get(fn) ?? []) : []),
  ])
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
 *
 * Nesting another resource underneath (`.use(resource('/:post/comments', ...))`)
 * needs both resources to share the same id param name — see {@link ResourceOptions.param}.
 */
export function resource(
  path: string,
  Controller: ControllerClass,
  options: ResourceOptions = {},
): ResourceRoute {
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
): ResourceRoute {
  return buildResource(path, Controller, options, API_ACTIONS)
}

/** Register several full resources at once (Laravel's `Route::resources`). */
export function resources(
  map: Record<string, ControllerClass>,
  options: ResourceOptions = {},
): Elysia {
  let app: any = new Elysia()
  for (const [name, ctrl] of Object.entries(map))
    app = app.use(resource(`/${name.replace(/^\/+/, '')}`, ctrl, options))
  return app as Elysia
}

/** Register several API (JSON-only) resources at once (Laravel's `Route::apiResources`). */
export function apiResources(
  map: Record<string, ControllerClass>,
  options: ResourceOptions = {},
): Elysia {
  let app: any = new Elysia()
  for (const [name, ctrl] of Object.entries(map))
    app = app.use(apiResource(`/${name.replace(/^\/+/, '')}`, ctrl, options))
  return app as Elysia
}

function buildResource(
  path: string,
  Controller: ControllerClass,
  options: ResourceOptions,
  base: ResourceAction[],
): ResourceRoute {
  const instance = new Controller()
  const param = options.param ?? 'id'
  const idPath = `/:${param}`
  const label = path.replace(/^\//, '').replace(/\/$/, '') || 'resource'
  // Shallow: member actions (show/edit/update/destroy) move to a flat
  // `/<resource>/:id` root instead of repeating the nested parent segment —
  // needs a SECOND, independent route root. Not shallow (the common case)
  // keeps the single original root: returning that same builder object
  // (not a re-wrapped one) is what lets a caller further `.use()` a nested
  // child resource onto it and have Elysia compound the prefixes correctly;
  // wrapping unconditionally in a fresh `new Elysia()` broke exactly that.
  const memberPath = options.shallow ? `/${lastStaticSegment(path)}` : path
  let collR: any = route(path)
  let memberR: any = options.shallow ? route(memberPath) : collR
  // When not shallow, coll/member are the SAME logical root — every mutation
  // to either must update both variables, since we can't assume Elysia's
  // fluent methods mutate in place (vs. returning a new instance) and still
  // have both names track the latest object.
  const setColl = (next: any) => {
    collR = next
    if (!options.shallow)
      memberR = next
  }
  const setMember = (next: any) => {
    memberR = next
    if (!options.shallow)
      collR = next
  }

  // Per-action mutable middleware list — ALWAYS passed by reference to the
  // route registration (never conditionally omitted), so `.middlewareFor()`/
  // `.withoutMiddlewareFor()` can mutate it *after* registration and have the
  // change visible at request time (the `middleware()` macro in middleware.ts
  // captures this exact array, not a copy).
  const mwByAction = new Map<ResourceAction, string[]>()
  const opts = (action: ResourceAction) => {
    const fn = instance[action]
    const mw = middlewareFor(action, options, Controller, typeof fn === 'function' ? fn : undefined)
    mwByAction.set(action, mw)
    return { middleware: mw }
  }

  const resolveModel = async (ctx: MiddlewareContext, action: ResourceAction): Promise<unknown> => {
    const id = ctx.params[param]
    const binder = options.bind as Binder
    const modelBinder = binder as ModelBinder
    const wantsTrashed = options.withTrashed === true
      ? action === 'show' || action === 'edit' || action === 'update'
      : Array.isArray(options.withTrashed) && options.withTrashed.includes(action)

    // Prefer the model's own resolveRouteBinding (custom field / scopes) — its
    // …WithTrashed sibling when withTrashed applies and the model has one; else
    // `find(id)`/`findWithTrashed(id)` by primary key; else a plain resolver fn.
    const model = wantsTrashed && typeof modelBinder.resolveRouteBindingWithTrashed === 'function'
      ? await modelBinder.resolveRouteBindingWithTrashed(id, options.bindField)
      : typeof modelBinder.resolveRouteBinding === 'function'
        ? await modelBinder.resolveRouteBinding(id, options.bindField)
        : wantsTrashed && typeof modelBinder.findWithTrashed === 'function'
          ? await modelBinder.findWithTrashed(id)
          : typeof modelBinder.find === 'function'
            ? await modelBinder.find(id)
            : await (binder as (id: string) => unknown)(String(id))

    if (model === null || model === undefined || !options.scoped)
      return model
    // `scoped`: confirm the resolved child actually belongs to its parent
    // route param(s) — a mismatch is treated exactly like "not found".
    for (const [parentParam, column] of Object.entries(options.scoped)) {
      if (String((model as Record<string, unknown>)[column]) !== ctx.params[parentParam])
        return null
    }
    return model
  }

  // Wrap id-based actions with model binding when `bind` is set.
  const bindAction = (action: ResourceAction, handler: RouteHandler): RouteHandler => {
    const needsModel = action === 'show' || action === 'edit' || action === 'update' || action === 'destroy'
    if (!options.bind || !needsModel)
      return handler
    return async (ctx) => {
      const model = await resolveModel(ctx, action)
      if (model === null || model === undefined) {
        return options.onMissing
          ? options.onMissing(ctx)
          : ctx.status(404, { message: trans('core::errors.not_found', { resource: label }, `${label} not found`) })
      }
      ctx.model = model
      return handler(ctx)
    }
  }

  // Wrap with the `@Authorize`'d ability check (runs after model binding, so
  // `ctx.model` is already resolved for show/update/destroy).
  const authorizeAction = (fn: RouteHandler, handler: RouteHandler): RouteHandler => {
    const ability = METHOD_AUTHORIZE.get(fn)
    if (!ability)
      return handler
    return async (ctx) => {
      const authorize = ctx.authorize as
        | ((a: string, ...x: unknown[]) => unknown)
        | undefined
      // Fail CLOSED. This used to be an optional call (`?.()`), so any route
      // tree without an authorizer on the context — plain `route()` instead of
      // `webRoute()`, `@elyvel/auth` not installed, a test harness, or a
      // mount-ordering slip — ran the action with NO authorization at all and
      // happily returned 200. It also wasn't awaited, so an async authorizer
      // became an unhandled rejection while the handler proceeded anyway.
      if (typeof authorize !== 'function') {
        throw new TypeError(
          `[elyvel] @Authorize('${ability}') cannot run: this route has no `
          + 'authorizer on its context. Mount the auth plugin on this route '
          + 'tree (e.g. use webRoute()/betterAuthPlugin) or remove the '
          + 'decorator — it must never be skipped silently.',
        )
      }
      // Collection actions (index/create/store) have no bound instance, so pass
      // the MODEL CLASS as the target — Gate resolves a policy from
      // `args[0].constructor` or from the class itself. Passing `undefined` meant
      // no policy matched, the check fell through to the named-ability map,
      // missed, and denied: `authorizeResource(PostController)` made `index`,
      // `create` and `store` permanently 403, which is the exact flow the docs
      // recommend. Worse, an unrelated global `define('create', ...)` would be
      // consulted instead of the model's policy.
      await authorize(ability, ctx.model ?? options.bind)
      return handler(ctx)
    }
  }

  // Run `@ValidateWith`'s FormRequest — after model binding + authorize (so
  // `ctx.model`/the ability check are already settled), before the action body.
  const validateAction = (fn: RouteHandler, handler: RouteHandler): RouteHandler => {
    const FormRequestClass = METHOD_FORM_REQUEST.get(fn)
    if (!FormRequestClass)
      return handler
    return async (ctx) => {
      ctx.validated = await FormRequestClass.validate(ctx)
      return handler(ctx)
    }
  }

  const bind = (action: ResourceAction): RouteHandler | undefined => {
    const fn = instance[action]
    if (typeof fn !== 'function')
      return undefined
    // Model binding must run FIRST so `ctx.model` exists by the time
    // `@Authorize` reads it — bindAction is the outer wrapper, authorize next,
    // `@ValidateWith` innermost (runs right before the action body).
    return bindAction(action, authorizeAction(fn, validateAction(fn, (fn as RouteHandler).bind(instance))))
  }

  const fullPath = (base: string, suffix: string) => `${base}${suffix}`.replace(/\/$/, '') || '/'
  const nameRoute = (action: ResourceAction, base: string, suffix: string) => {
    const override = options.names?.[action]
    if (override)
      named(override, fullPath(base, suffix))
    else if (options.name)
      named(`${options.name}.${action}`, fullPath(base, suffix))
  }
  const recordMeta = (method: string, action: ResourceAction, base: string, suffix: string) => {
    const fn = instance[action]
    const path = fullPath(base, suffix)
    ROUTE_META.push({
      method,
      path,
      middleware: mwByAction.get(action) ?? [],
      authorize: typeof fn === 'function' ? METHOD_AUTHORIZE.get(fn) : undefined,
    })
    // `@WithoutMiddleware` used to filter only the route's OWN list, so an action
    // could not opt out of middleware applied by `global` or by a group — those
    // run from their own hooks and never see that list. Register the exemption
    // against the matched route so the shared guard runner honours it as well.
    const without = withoutNames(Controller, typeof fn === 'function' ? fn : undefined)
    if (without.size)
      excludeMiddleware(method, path, [...without])
  }

  for (const action of selectedActions(options, base)) {
    const handler = bind(action)
    if (!handler)
      continue
    switch (action) {
      case 'index':
        setColl(collR.get('/', handler, opts(action)))
        nameRoute(action, path, '')
        recordMeta('GET', action, path, '')
        break
      case 'create':
        // Registered before `/:id` so it isn't swallowed by the id route.
        setColl(collR.get('/create', handler, opts(action)))
        nameRoute(action, path, '/create')
        recordMeta('GET', action, path, '/create')
        break
      case 'store':
        setColl(collR.post('/', handler, opts(action)))
        nameRoute(action, path, '')
        recordMeta('POST', action, path, '')
        break
      case 'show':
        setMember(memberR.get(idPath, handler, opts(action)))
        nameRoute(action, memberPath, idPath)
        recordMeta('GET', action, memberPath, idPath)
        break
      case 'edit':
        setMember(memberR.get(`${idPath}/edit`, handler, opts(action)))
        nameRoute(action, memberPath, `${idPath}/edit`)
        recordMeta('GET', action, memberPath, `${idPath}/edit`)
        break
      case 'update':
        setMember(memberR.put(idPath, handler, opts(action)).patch(idPath, handler, opts(action)))
        nameRoute(action, memberPath, idPath)
        recordMeta('PUT', action, memberPath, idPath)
        recordMeta('PATCH', action, memberPath, idPath)
        break
      case 'destroy':
        setMember(memberR.delete(idPath, handler, opts(action)))
        nameRoute(action, memberPath, idPath)
        recordMeta('DELETE', action, memberPath, idPath)
        break
    }
  }
  // Not shallow: collR/memberR are the same object (see setColl/setMember) —
  // return it directly, unwrapped, so a caller's further `.use()` (nesting
  // another resource under this one) still compounds prefixes correctly.
  const result: any = options.shallow ? new Elysia().use(collR).use(memberR) : collR

  const asActions = (actions: ResourceAction | ResourceAction[]): ResourceAction[] =>
    Array.isArray(actions) ? actions : [actions]
  const asNames = (names: string | string[]): string[] => (Array.isArray(names) ? names : [names])

  // Laravel's `->middleware()` (`Route::resource(...)->middleware([...])`) — add
  // to EVERY action registered by this resource.
  result.middleware = (names: string | string[]): ResourceRoute => {
    for (const list of mwByAction.values()) list.push(...asNames(names))
    return result
  }
  // Laravel's `->middlewareFor()` — add to specific action(s) only.
  result.middlewareFor = (actions: ResourceAction | ResourceAction[], names: string | string[]): ResourceRoute => {
    for (const action of asActions(actions)) mwByAction.get(action)?.push(...asNames(names))
    return result
  }
  // Laravel's `->withoutMiddlewareFor()` — remove from specific action(s).
  result.withoutMiddlewareFor = (actions: ResourceAction | ResourceAction[], names: string | string[]): ResourceRoute => {
    const remove = new Set(asNames(names))
    for (const action of asActions(actions)) {
      const list = mwByAction.get(action)
      if (!list)
        continue
      const kept = list.filter(n => !remove.has(n))
      list.length = 0
      list.push(...kept)
    }
    return result
  }

  return result as ResourceRoute
}

/** Singleton resource actions (no `:id` — one instance per context, e.g. `/profile`). */
export type SingletonAction = 'create' | 'store' | 'show' | 'edit' | 'update' | 'destroy'

const SINGLETON_BASE: SingletonAction[] = ['show', 'edit', 'update']
const API_SINGLETON_BASE: SingletonAction[] = ['show', 'update']

export interface SingletonOptions {
  only?: SingletonAction[]
  except?: SingletonAction[]
  /** Add `create`/`store`/`destroy` (Laravel's `->creatable()`). */
  creatable?: boolean
  /** Add `destroy` only, without `create`/`store` (Laravel's `->destroyable()`). */
  destroyable?: boolean
  middleware?: string[] | Partial<Record<SingletonAction, string[]>>
  name?: string
}

function buildSingleton(
  path: string,
  Controller: ControllerClass,
  options: SingletonOptions,
  base: SingletonAction[],
  /** `creatable`'s extra actions — regular singletons get a `create` form route, API ones don't. */
  creatableExtras: SingletonAction[],
): Elysia {
  const instance = new Controller()
  let all: SingletonAction[] = base
  if (options.creatable)
    all = [...all, ...creatableExtras]
  else if (options.destroyable)
    all = [...all, 'destroy']
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
  const nameRoute = (action: SingletonAction, suffix: string) => {
    if (options.name)
      named(`${options.name}.${action}`, `${path}${suffix}`.replace(/\/$/, '') || '/')
  }

  for (const action of actions) {
    const handler = bind(action)
    if (!handler)
      continue
    switch (action) {
      case 'create':
        r = r.get('/create', handler, mwOf(action))
        nameRoute(action, '/create')
        break
      case 'store':
        r = r.post('/', handler, mwOf(action))
        nameRoute(action, '')
        break
      case 'show':
        r = r.get('/', handler, mwOf(action))
        nameRoute(action, '')
        break
      case 'edit':
        r = r.get('/edit', handler, mwOf(action))
        nameRoute(action, '/edit')
        break
      case 'update':
        r = r.put('/', handler, mwOf(action)).patch('/', handler, mwOf(action))
        nameRoute(action, '')
        break
      case 'destroy':
        r = r.delete('/', handler, mwOf(action))
        nameRoute(action, '')
        break
    }
  }
  return r as Elysia
}

/**
 * Register a singleton resource, à la Laravel's `Route::singleton` — a resource
 * with no id (one instance per context, like `/profile` or `/settings`):
 *
 * | Verb        | Path         | Action   |
 * |-------------|--------------|----------|
 * | GET         | `/`          | `show`   |
 * | GET         | `/edit`      | `edit`   |
 * | PUT / PATCH | `/`          | `update` |
 *
 * `->creatable()` adds `create`/`store`/`destroy`; `->destroyable()` adds just
 * `destroy` without create/store. The controller resolves the single instance
 * itself (e.g. from `ctx.user`).
 */
export function singleton(
  path: string,
  Controller: ControllerClass,
  options: SingletonOptions = {},
): Elysia {
  return buildSingleton(path, Controller, options, SINGLETON_BASE, ['create', 'store', 'destroy'])
}

/**
 * A JSON-only singleton resource, à la Laravel's `Route::apiSingleton` — like
 * {@link singleton}, but without `create`/`edit` (which render forms):
 *
 * | Verb        | Path | Action   |
 * |-------------|------|----------|
 * | GET         | `/`  | `show`   |
 * | PUT / PATCH | `/`  | `update` |
 */
export function apiSingleton(
  path: string,
  Controller: ControllerClass,
  options: SingletonOptions = {},
): Elysia {
  return buildSingleton(path, Controller, options, API_SINGLETON_BASE, ['store', 'destroy'])
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
