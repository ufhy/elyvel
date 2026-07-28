# Routing

Routes live in the `routes/` directory. Every file there is **auto-mounted at
boot** — you default-export a router and the framework wires it up; there's no
central route-registration file to maintain.

## Basic routing

Create a router with `route()` and attach handlers with the HTTP verb methods:

```ts
// routes/web.ts
import { route } from '@elyvel/core'

export default route()
  .get('/api/health', () => ({ status: 'ok' }))
  .post('/api/webhooks', ({ body }) => process(body))
```

The handler receives the request context (`request`, `params`, `query`, `body`,
`set`, `status`, and anything middleware derived, like `user`). Whatever you
return is the response:

- Return a value (object, array, string) → serialized to **JSON**.
- Return `Inertia.render(...)` or `view(...)` → **HTML**.
- Call `status(code, body)` → set an explicit status.

```ts
route().get('/teapot', ({ status }) => status(418, { message: "I'm a teapot" }))
```

## Route parameters

Dynamic segments use `:name` and arrive in `params`:

```ts
route().get('/posts/:id', ({ params }) => Post.find(params.id))
```

## Route files

Each file under `routes/` default-exports a router; they're all mounted at boot.
Group related routes into their own files (`routes/web.ts`, `routes/blog.ts`,
`routes/api.ts`) — no manual registration.

## Middleware

Attach middleware per route with the `middleware` option — a single alias or a
list. Aliases are named in `config/middleware.ts`, and an alias can take
arguments after a colon:

```ts
route()
  .get('/dashboard', handler, { middleware: 'auth' })
  .post('/comments', handler, { middleware: ['auth', 'throttle:60,1'] })
```

See [Middleware](/basics/middleware) for writing middleware, the config
buckets (`global` / `aliases` / `groups`), the built-ins, and the
`@UseMiddleware`/`@WithoutMiddleware` controller decorators.

## Route groups

Pass `middleware` to `route()` to apply it to **every** route in that file
(Laravel's `Route::group(['middleware' => ...])`), and a prefix as the first
argument:

```ts
route('/admin', { middleware: ['auth'] })
  .get('/users', listUsers) // GET /admin/users, behind `auth`
  .get('/settings', settings)
```

Reusable bundles are declared as **groups** and applied with `.use(group())`.
The built-in `web` group adds CSRF protection for cookie-based routes (API/token
routes are CSRF-immune, so leave them out of it):

```ts
import { group, route } from '@elyvel/core'

export default route()
  .use(group('web')) // CSRF for browser/session routes
  .post('/profile', updateProfile)
```

## Controllers & resource routes

For a full RESTful resource, point `resource()` at a controller — it wires the
standard actions à la Laravel's `Route::resource`:

```ts
import { resource } from '@elyvel/core'
import { PostController } from '../app/controllers/PostController'

export default resource('/posts', PostController)
```

| Verb | Path | Controller action |
| --- | --- | --- |
| GET | `/posts` | `index` |
| GET | `/posts/create` | `create` |
| POST | `/posts` | `store` |
| GET | `/posts/:id` | `show` |
| GET | `/posts/:id/edit` | `edit` |
| PUT / PATCH | `/posts/:id` | `update` |
| DELETE | `/posts/:id` | `destroy` |

Only the actions your controller actually defines are wired. For a JSON-only API
use `apiResource()`, which drops the form-rendering `create`/`edit` routes.

::: tip HTML forms and PUT/PATCH/DELETE
An HTML `<form>` can only `GET`/`POST`, so `update`/`destroy` routes are
unreachable from a plain form post — unless it spoofs the method. This is
handled automatically for every request (Laravel's `@method` directive): a
hidden `_method` field (`<input type="hidden" name="_method" value="PUT">`),
a `?_method=` query param, or an `X-HTTP-Method-Override` header all work
on an otherwise-`POST` request, with no setup needed.
:::

Scope actions with `only` / `except`, and apply middleware per action:

```ts
resource('/posts', PostController, {
  only: ['index', 'show', 'store'],
  middleware: {
    store: ['auth', 'csrf'],
  },
})
```

### Adjusting middleware after registration

The object `resource()`/`apiResource()` returns also has Laravel's fluent
post-registration adjustments — handy when you'd rather tweak one resource's
middleware at the call site than thread it through `options.middleware`:

```ts
resource('/posts', PostController)
  .middleware('auth') // every action
  .middlewareFor(['store', 'update', 'destroy'], 'verified') // just these
  .withoutMiddlewareFor('index', 'auth') // index stays public
```

### Controller-level middleware, authorization & validation

Instead of (or alongside) `resource(..., { middleware })`, a controller can
declare its own middleware, ability checks, and validation with decorators —
Laravel's `#[Middleware]`/`#[Authorize]`/type-hinted-`FormRequest` equivalents.
They're merged with whatever `resource()`'s own options add, not replaced by them:

```ts
import { Authorize, Controller, UseMiddleware, ValidateWith, WithoutMiddleware } from '@elyvel/core'
import { StorePostRequest } from '../requests/StorePostRequest'

@UseMiddleware('auth', 'subscribed')
export class PostController extends Controller {
  @WithoutMiddleware('subscribed') // only 'auth' applies to index
  async index(ctx: MiddlewareContext) { /* ... */ }

  @ValidateWith(StorePostRequest)
  async store(ctx: MiddlewareContext) {
    return Post.create(ctx.validated) // already validated — no manual .validate() call
  }

  @Authorize('update') // ctx.authorize('update', ctx.model) before the action runs
  async update(ctx: MiddlewareContext) { /* ... */ }
}
```

`@UseMiddleware`/`@WithoutMiddleware` work on the class (every action) or a
single method. `@Authorize` runs *after* route model binding, so `ctx.model` is
already resolved when it checks the ability.

For a whole resource, `authorizeResource()` wires every action to its
conventional policy ability at once (Laravel's `$this->authorizeResource()`) —
`index`→`viewAny`, `show`→`view`, `create`/`store`→`create`,
`edit`/`update`→`update`, `destroy`→`delete` — instead of an `@Authorize` on
each method. An explicit `@Authorize` on a specific method still wins:

```ts
authorizeResource(PostController)
export default resource('/posts', PostController, { bind: Post })
```

### Composing several resources

A route file default-exports **one** router, but `resource()` returns a
composable plugin — so you don't need a file per resource. Chain as many as you
like with `.use()` in a single file:

```ts
// routes/api.ts
export default route()
  .use(resource('/posts', PostController))
  .use(resource('/users', UserController))
  .use(resource('/comments', CommentController))
```

Or register several at once with `resources()`/`apiResources()` (Laravel's
`Route::resources`/`Route::apiResources`) — a map of URL segment → controller,
sharing the same options:

```ts
import { resources } from '@elyvel/core'

export default resources({
  posts: PostController,
  users: UserController,
  comments: CommentController,
})
```

How you split them is purely organizational: keep them together, or group by
domain across several files (`routes/blog.ts`, `routes/shop.ts`) or even
subfolders (`routes/admin/*.ts`). Every `*.ts` under `routes/` — subfolders
included — is auto-mounted.

## Route model binding

Pass `bind` to resolve the URL parameter into a model instance automatically
(Laravel's implicit binding). The resolved model is available as `ctx.model` in
the controller:

```ts
resource('/posts', PostController, {
  bind: Post, // /posts/:id → Post.find(id), injected as ctx.model
})
```

Bind by a column other than the primary key with the `bindField` **option**
(Laravel's `/posts/{post:slug}`) — the URL segment name doesn't change:

```ts
resource('/posts', PostController, { bind: Post, bindField: 'slug' })
```

Allow soft-deleted rows to resolve too (Laravel's `->withTrashed()`) — `true`
applies to `show`/`edit`/`update` (Laravel's default), or name a subset of
actions explicitly. The bound model needs `findWithTrashed`/
`resolveRouteBindingWithTrashed` (elyvel's own `Model` has both):

```ts
resource('/posts', PostController, { bind: Post, withTrashed: true })
```

Run your own handler instead of the default 404 when binding finds nothing,
with `onMissing`:

```ts
resource('/posts', PostController, {
  bind: Post,
  onMissing: ctx => ctx.status(404, { message: 'No such post.' }),
})
```

### Nesting resources

Rename the segment with `param` — needed when nesting resources, so the parent
and child agree on the parameter name:

```ts
resource('/blog', PostController, { bind: Post, param: 'post' })
  .use(apiResource('/:post/comments', CommentController, { bind: Comment }))
```

Verify the bound child actually belongs to its parent instead of resolving it
by id alone, with `scoped` (Laravel's `->scoped()`) — a mismatch 404s (or runs
`onMissing`) exactly like a missing row:

```ts
resource('/photos/:photo/comments', CommentController, {
  bind: Comment,
  scoped: { photo: 'photo_id' },
})
// GET /photos/1/comments/5 → 404 unless Comment#5's photo_id is 1
```

For a deeply-nested resource, `shallow` (Laravel's `->shallow()`) keeps the
collection actions (`index`/`create`/`store`) under the full nested path, but
moves the member actions (`show`/`edit`/`update`/`destroy` — which already
carry a unique id) to a flat `/<resource>/:id` path instead of repeating the
parent segment:

```ts
resource('/photos/:photo/comments', CommentController, { shallow: true })
// index/create/store → /photos/:photo/comments
// show/edit/update/destroy → /comments/:id
```

## Singleton resources

For a resource with no id — one instance per context, like `/profile` or
`/settings` — use `singleton()` (Laravel's `Route::singleton`) instead of
`resource()`. The controller resolves the single instance itself (e.g. from
`ctx.user`):

| Verb | Path | Action |
| --- | --- | --- |
| GET | `/` | `show` |
| GET | `/edit` | `edit` |
| PUT / PATCH | `/` | `update` |

```ts
import { singleton } from '@elyvel/core'

export default singleton('/profile', ProfileController)
```

`{ creatable: true }` adds `create`/`store`/`destroy` (Laravel's
`->creatable()`); `{ destroyable: true }` adds just `destroy` without
create/store. `apiSingleton()` is the JSON-only variant (no `create`/`edit`
form routes) — `show`/`update` by default, `{ creatable: true }` adds
`store`/`destroy`.

## Single-action controllers

For a controller that only does one thing, define `handle()` (or `__invoke()`)
and wire it with `invoke()` (Laravel's single-action controllers) instead of a
full `resource()`:

```ts
import { invoke, route } from '@elyvel/core'
import { ProvisionServer } from '../app/controllers/ProvisionServer'

export default route().post('/provision', invoke(ProvisionServer))
```

## Fallback routes

`fallback()` (Laravel's `Route::fallback`) runs when nothing else matches —
default-export it from a `routes/` file (loaded last) or `.use()` it on the root:

```ts
import { fallback } from '@elyvel/core'

export default fallback(ctx => ctx.status(404, { message: 'Not found.' }))
```

## Named routes & URL generation

Name a route template, then build URLs from it with `urlFor()` (Laravel's
`route()` helper):

```ts
import { named, urlFor } from '@elyvel/core'

named('posts.show', '/posts/:id')

urlFor('posts.show', { id: 42 }) // "/posts/42"
urlFor('posts.index', { page: 2 }) // "/posts?page=2" — extras become query params
```

`resource()`/`apiResource()` can register a name for every one of their actions
at once with the `name` option — each action gets `<name>.<action>`
(`posts.index`, `posts.show`, ...):

```ts
resource('/posts', PostController, { name: 'posts' })
```

Override a specific action's name with `names` (Laravel's `->names()`) instead
of the uniform pattern:

```ts
resource('/photos', PhotoController, {
  name: 'photos',
  names: { create: 'photos.build' }, // create → photos.build; the rest → photos.<action>
})
```

## Inspecting routes

List every registered route with the CLI:

```bash
elyvel route:list
```

For routes registered via `resource()`/`apiResource()`, it also shows the
**Middleware** and **Authorize** columns (from `@UseMiddleware`/`resource({
middleware })` and `@Authorize`/`authorizeResource()`). It does not currently
list named routes — that's tracked separately via `named()`/`urlFor()`, not
surfaced by this command.
