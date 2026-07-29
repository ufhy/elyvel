# Authorization

Authorization answers "is this user allowed to do this?" — separate from
authentication ("who is this user?"). elyvel's **gate** provides both named
abilities and per-model **policies** (Laravel's `Gate`/`Policy`).

## The gate

`gate()` is the process-wide default gate, configured once (typically in a
service provider's `boot()`):

```ts
import { gate } from '@elyvel/auth'

export class AppServiceProvider extends ServiceProvider {
  override boot(): void {
    gate().policy(Post, new PostPolicy())
  }
}
```

### Named abilities

Define a standalone ability with a closure — useful for checks that aren't
about a specific model:

```ts
gate().define('viewAdminPanel', user => user?.role === 'admin')
```

```ts
gate().allows('viewAdminPanel', user) // boolean
```

By default an ability doesn't run at all for a guest (`user` is `null`) — pass
`{ allowGuest: true }` as a third argument when the ability itself needs to
handle the unauthenticated case:

```ts
gate().define('viewPublicStats', user => user === null || user.role !== 'banned', {
  allowGuest: true,
})
```

## Policies

A policy groups the abilities for one model into a class — one method per
ability, named after the action:

```ts
// app/policies/PostPolicy.ts
import type { User } from '@elyvel/auth'
import type { Post } from '../models/Post'
import { Response } from '@elyvel/auth'

export class PostPolicy {
  /** Any signed-in user may create a post. */
  create(_user: User | null): boolean {
    return true
  }

  /** Only the author may update their post. */
  update(user: User | null, model: Post): boolean | Response {
    return user?.id === model.user_id
      ? Response.allow()
      : Response.deny('You can only edit your own posts.')
  }
}

export default PostPolicy
```

Generate one with `bunx elyvel make:policy PostPolicy --model=Post`. Register
it against its model — the gate then routes any check whose first argument is
a `Post` instance (or the `Post` class itself, for `create`-style checks) to
this policy:

```ts
gate().policy(Post, new PostPolicy())
```

::: danger Abilities and policy methods must be synchronous
The gate is synchronous — `can`, `ctx.can`, `gate().allows()` and the
`@Authorize` decorator all return a `boolean` immediately, with nothing to
await. An `async` method therefore returns a Promise, and a Promise is truthy:

```ts
class PostPolicy {
  // ✗ Rejected at runtime — the check never runs.
  async update(user: User | null, post: Post) {
    await post.load('team')
    return user?.id === post.user_id
  }
}
```

Rather than silently allowing everything, the gate **throws** when an ability
or policy method returns a Promise. Resolve what the check needs *before*
calling it — eager-load the relation on the query that fetched the model, or
pass the value in as an extra argument:

```ts
const post = await Post.query().with('team').findOrFail(id)
gate().allows('update', user, post) // the policy method reads post.team, no await
```

The same applies to `policy.before`, `Gate.before` and `Gate.after` hooks.
:::

A method can return a plain `boolean`, or a `Response` when you want a specific
denial message/status: `Response.allow()`, `Response.deny(message, status?)`,
`Response.denyWithStatus(status, message?)` (set the status without the
default "unauthorized" message), `Response.denyAsNotFound()` (404 instead of
403 — hides a resource's existence from unauthorized users).

### `before` — a policy-wide filter

Runs before any of the policy's methods; a non-`null`/`undefined` result
short-circuits (e.g. a super-admin bypass):

```ts
class PostPolicy {
  before(user: User | null): boolean | undefined {
    if (user?.role === 'admin')
      return true // skip the rest of the checks
    return undefined // fall through to the specific method
  }
}
```

The gate itself also has process-wide `before`/`after` hooks — for logic that
should apply across *every* ability/policy, not just one policy's methods
(Laravel's `Gate::before`/`Gate::after`):

```ts
gate().before((user, ability, args) => {
  if (user?.role === 'super-admin')
    return true // short-circuits every check, any ability
  return undefined // fall through as usual
})

gate().after((user, ability, result, args) => {
  // only consulted when the ability/policy itself returned null/undefined
})
```

## Checking abilities

The gate exposes the checks directly, or bind a user once with `forUser` for a
per-request ergonomic surface (this is what `ctx.can`/`ctx.cannot`/`ctx.authorize`
are, in a route handler — see [Authentication](/security/authentication)):

```ts
gate().allows('update', user, post) // boolean
gate().denies('update', user, post) // boolean
gate().check('update', user, post) // alias of allows
gate().any(['update', 'delete'], user, post) // true if ANY ability passes
gate().none(['update', 'delete'], user, post) // true if NONE pass
gate().inspect('update', user, post) // the full Response — allowed()/message()/status()
gate().forUser(user).authorize('update', post) // throws AuthorizationError if denied
```

`forUser(user)` returns the same `check`/`any`/`none`/`inspect` surface with
`user` already bound (`gate().forUser(user).any([...], post)`, etc).

In a controller:

```ts
async update(ctx: MiddlewareContext) {
  ctx.authorize('update', ctx.model) // throws 403 (or the policy's Response) if denied
  const data = await UpdatePostRequest.validate(ctx)
  return ctx.model.update(data)
}
```

## Guarding a route by ability

On a `webRoute()` router (which wires in the auth layer — see
[Authentication](/security/authentication)), pass `can` as a route option to
deny before the handler runs at all. Resolver functions receive the request
context; other values pass through as extra arguments to the ability:

```ts
webRoute().delete('/posts/:id', destroy, {
  can: ['update', ctx => ctx.model],
})
```

### Authorizing a whole resource controller

Instead of an ability check inside every action, `@Authorize` on a controller
method runs the check before the action (using `ctx.model` when the route is
model-bound):

```ts
import { Authorize, Controller } from '@elyvel/core'

export class PostController extends Controller {
  @Authorize('update')
  async update(ctx: MiddlewareContext) { /* ctx.model already checked */ }
}
```

`authorizeResource()` wires every resource action to its conventional ability
at once (Laravel's `$this->authorizeResource()`) — `index`→`viewAny`,
`show`→`view`, `create`/`store`→`create`, `edit`/`update`→`update`,
`destroy`→`delete` — called where the resource is registered, not inside the
class. An explicit `@Authorize` on a specific method still wins over the default:

```ts
// routes/web.ts
import { authorizeResource, resource } from '@elyvel/core'

authorizeResource(PostController)
export default resource('/posts', PostController, { bind: Post })
```

See [Controllers](/basics/controllers#authorizing-actions) for more.

## Inline checks

For a one-off condition that doesn't warrant a named ability or policy method,
`allowIf`/`denyIf` throw directly:

```ts
gate().allowIf(user?.emailVerified === true, user, 'Verify your email first.')
```
