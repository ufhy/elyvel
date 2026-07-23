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
list. Aliases (and any group names) are defined in `config/middleware.ts`:

```ts
// config/middleware.ts
export default defineMiddlewareConfig({
  global: [/* runs on every request */],
  aliases: {
    auth: AuthGuard,
    verified: VerifiedGuard,
    throttle: ThrottleMiddleware,
  },
  groups: {
    web: [TrimStringsMiddleware, CsrfMiddleware],
  },
})
```

```ts
route()
  .get('/dashboard', handler, { middleware: 'auth' })
  .post('/comments', handler, { middleware: ['auth', 'throttle:60,1'] })
```

An alias can take arguments after a colon — `throttle:60,1` passes `"60"` and
`"1"` to the middleware's `handle(context, ...args)`.

A middleware is a class extending `Middleware`. Return a response from `handle()`
to short-circuit, or nothing to continue; an optional `terminate()` runs *after*
the response is sent (logging, cleanup):

```ts
import { Middleware } from '@elyvel/core'

export class EnsureTeamMember extends Middleware {
  handle(ctx) {
    if (!ctx.user?.teamId)
      return ctx.status(403, { message: 'Not on a team.' })
  }
}
```

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

Scope actions with `only` / `except`, and apply middleware per action:

```ts
resource('/posts', PostController, {
  only: ['index', 'show', 'store'],
  middleware: {
    store: ['auth', 'csrf'],
  },
})
```

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

Rename the segment with `param` — needed when nesting resources, so the parent
and child agree on the parameter name:

```ts
resource('/blog', PostController, { bind: Post, param: 'post' })
  .use(apiResource('/:post/comments', CommentController, { bind: Comment }))
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

## Inspecting routes

List every registered route (and named route) with the CLI:

```bash
elyvel route:list
```
