# Controllers

Instead of defining every handler as a closure in a route file, you can group
related request-handling logic into a **controller** class. Controllers pair
naturally with `resource()` / `apiResource()` (see [Routing](/basics/routing)).

## Writing a controller

A controller extends `Controller` and defines a method per action. Each method
receives the request context and returns a response:

```ts
// app/controllers/PostController.ts
import type { MiddlewareContext } from '@elyvel/core'
import { Controller } from '@elyvel/core'
import { Post } from '../models/Post'

export class PostController extends Controller {
  /** GET /posts */
  async index() {
    return Post.query().latest().get()
  }

  /** GET /posts/:id */
  async show(ctx: MiddlewareContext) {
    return Post.find(ctx.params.id)
  }

  /** POST /posts */
  async store(ctx: MiddlewareContext) {
    return Post.create(ctx.body as Record<string, unknown>)
  }
}
```

Generate one with the CLI — it scaffolds the five JSON actions
(`index`/`show`/`store`/`update`/`destroy`):

```bash
bunx elyvel make:controller PostController
```

## The resource actions

`resource()` and `apiResource()` map HTTP verbs to controller methods. **Only
the methods you actually define are routed**, so a read-only controller is just
`index` + `show`.

| Method | Verb · Path | Notes |
| --- | --- | --- |
| `index` | GET `/` | list |
| `create` | GET `/create` | render a create form (`resource` only) |
| `store` | POST `/` | persist a new record |
| `show` | GET `/:id` | show one |
| `edit` | GET `/:id/edit` | render an edit form (`resource` only) |
| `update` | PUT/PATCH `/:id` | persist changes |
| `destroy` | DELETE `/:id` | delete |

`apiResource()` wires the five JSON actions; `resource()` adds the form-rendering
`create`/`edit`. Wire a controller in a `routes/` file:

```ts
// routes/blog.ts
import { resource } from '@elyvel/core'
import { PostController } from '../app/controllers/PostController'

export default resource('/posts', PostController, { bind: Post })
```

## The request context

Every action receives the `MiddlewareContext` (`ctx`):

- `ctx.params` — route parameters (`ctx.params.id`).
- `ctx.query` — parsed query string.
- `ctx.body` — parsed request body (JSON or `multipart/form-data`, where file
  fields are `File` instances).
- `ctx.user` — the authenticated user, when the route runs through the auth
  layer (see [Authentication](/security/authentication)).
- `ctx.model` — the bound model instance, when the resource was registered with
  `bind` (route-model binding). It's resolved before the action runs, so it's
  always a loaded record — or the request already 404'd.

```ts
async show(ctx: MiddlewareContext) {
  return ctx.model // the Post resolved from /:id via `bind: Post`
}
```

## Validating input

Validate with a [FormRequest](/basics/routing) — call its static `validate(ctx)`,
which returns the validated data or throws a `422`:

```ts
import { StorePostRequest } from '../requests/StorePostRequest'

async store(ctx: MiddlewareContext) {
  const data = await StorePostRequest.validate(ctx)
  return Post.create(data)
}
```

## Authorizing actions

When the route runs through the auth layer, `ctx.authorize(ability, …)` enforces
a policy — throwing a `403` if it fails:

```ts
async store(ctx: MiddlewareContext) {
  ctx.authorize('create', Post)
  const data = await StorePostRequest.validate(ctx)
  return Post.create(data)
}
```

See [Authorization](/security/authorization) for the gate and policies.

## Responses

Whatever an action returns becomes the response:

- A value (object/array) → **JSON**.
- `Inertia.render(page, props)` (from `@elyvel/inertia`) or `view(name, data)`
  (from `@elyvel/view`) → **HTML**.
- `redirect(url)` / `back()` (from `@elyvel/core`) → a redirect.
- `Resource` / `Resource.paginated(...)` (from `@elyvel/core`) → a shaped JSON
  transform for API responses.

```ts
import { redirect } from '@elyvel/core'

async destroy(ctx: MiddlewareContext) {
  await ctx.model.delete()
  return redirect('/posts')
}
```
