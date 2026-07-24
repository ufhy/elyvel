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

A method can return a plain `boolean`, or a `Response` when you want a specific
denial message/status: `Response.allow()`, `Response.deny(message, status?)`,
`Response.denyAsNotFound()` (404 instead of 403 — hides a resource's existence
from unauthorized users).

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

## Checking abilities

The gate exposes the checks directly, or bind a user once with `forUser` for a
per-request ergonomic surface (this is what `ctx.can`/`ctx.cannot`/`ctx.authorize`
are, in a route handler — see [Authentication](/security/authentication)):

```ts
gate().allows('update', user, post) // boolean
gate().denies('update', user, post) // boolean
gate().forUser(user).authorize('update', post) // throws AuthorizationError if denied
```

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

## Inline checks

For a one-off condition that doesn't warrant a named ability or policy method,
`allowIf`/`denyIf` throw directly:

```ts
gate().allowIf(user?.emailVerified === true, user, 'Verify your email first.')
```
