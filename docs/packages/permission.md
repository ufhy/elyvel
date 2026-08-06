# Permission

`@elyvel/permission` stores **roles and permissions in the database**, the way
[spatie/laravel-permission](https://github.com/spatie/laravel-permission) does:
you hand a user a role, the role carries permissions, and your code asks
"may they?" without hard-coding anybody's job title.

It complements [authorization](/security/authorization) rather than replacing
it: `Gate` and policies still answer questions about *a specific record*
("may Ada edit **this** post?"). This package answers questions about *what a
person is allowed to do at all*, and it can feed the Gate the answer.

## Installation

```sh
bun add @elyvel/permission
bun elyvel permission:migration   # writes the migration
bun elyvel migrate                # creates the five tables
```

Then apply the concern to whichever model receives roles:

```ts
// app/models/User.ts
import { Model, withConcerns } from '@elyvel/database'
import { HasRoles, type HasRolesFields } from '@elyvel/permission'

// eslint-disable-next-line ts/no-unsafe-declaration-merging
export interface User extends HasRolesFields {}

// eslint-disable-next-line ts/no-unsafe-declaration-merging
export class User extends Model {
  static override table = 'users'
}
withConcerns(User, HasRoles)
```

The `interface User extends HasRolesFields` line is what makes
`user.assignRole(...)` type-check — the same recipe as any other
[model concern](/database/eloquent#model-concerns-trait-equivalent).

## Everything is `await`

This is the one real difference from Laravel. There, `$user->hasRole('admin')`
hides its queries behind a lazy relation; here every check is a database read,
so every check is asynchronous:

```ts
await Role.create({ name: 'writer', guard: 'web' })
await Permission.create({ name: 'edit posts', guard: 'web' })

await user.assignRole('writer')
await user.givePermissionTo('edit posts')   // straight to the user, no role

await user.hasRole('writer')                // true
await user.hasPermissionTo('edit posts')    // true
await user.getAllPermissions()              // ['edit posts']
```

Inside a request you rarely write these — see [Gate integration](#gate-integration).

### The full surface

| Roles | Permissions |
| --- | --- |
| `assignRole(...)` | `givePermissionTo(...)` |
| `removeRole(...)` | `revokePermissionTo(...)` |
| `syncRoles(...)` | `syncPermissions(...)` |
| `hasRole(names, guard?)` | `hasPermissionTo(names, guard?)` |
| `hasAnyRole(...)` | `hasAllPermissions(names, guard?)` |
| `hasAllRoles(names, guard?)` | `hasDirectPermission(name, guard?)` |
| `getRoleNames()` | `getAllPermissions()` |
| `roles()` → `Role[]` | `permissions()` → `Permission[]` (direct only) |

Names may be piped — `hasRole('admin|editor')` means either, matching the
string form the middleware passes.

**A name that doesn't exist throws.** `assignRole('wrtier')` is an error, not a
no-op: silently assigning nothing is how an authorization bug ships, because
the call site reads exactly as if it had worked.

## Roles on any model

The two pivot tables are polymorphic (`model_type` + `model_id`), so roles
aren't a user-only feature — apply the concern to a `Team`, an `ApiClient`,
whatever needs one. Two different models sharing a row id keep separate roles.

## Middleware

Register the aliases once:

```ts
// config/middleware.ts
import { defineMiddlewareConfig } from '@elyvel/core'
import { permissionMiddlewareAliases } from '@elyvel/permission'

export default defineMiddlewareConfig({
  aliases: { ...permissionMiddlewareAliases },
  groups: {
    web: ['permissions'], //  ← loads the current user's names; see below
  },
})
```

Then guard routes:

```ts
route().get('/admin', handler, { middleware: 'role:admin|editor' })
route().post('/posts', handler, { middleware: 'permission:create posts' })
route().get('/panel', handler, { middleware: 'role_or_permission:admin|view panel' })
```

A pipe means "any of these". A second argument narrows the guard:
`role:admin,api`. A caller who isn't logged in gets **403**, not 401 — the same
choice spatie makes: the route exists and the request is answerable, the caller
simply may not have it.

## Gate integration

`Gate` is deliberately synchronous, and throws if an ability returns a Promise
— a past bug where an async policy returned a truthy Promise and authorized
everything is why. Permission checks read the database, so they can't be
plugged into it directly.

`PermissionContextMiddleware` (the `permissions` alias above) resolves this:
it loads the authenticated user's role and permission names **once per
request** into [Context](/digging-deeper/context), and the Gate hook then
answers from that in-memory set.

```ts
// with the middleware in the group, this just works:
gate().allows('edit posts', user)   // synchronous, reads the loaded names
```

Two things follow from this design, both deliberate:

- **Without the middleware, the Gate hook abstains** — it returns "no opinion",
  so abilities you defined yourself still decide. It does not deny.
- **Outside a request** (queued jobs, CLI, tinker) nothing is loaded, so use
  `await user.hasPermissionTo(...)` there.

Put the middleware *after* whatever authenticates the request; it reads
`ctx.user`.

### Telling it what your user is

With Better Auth, `ctx.user` is a **plain object**, not an Eloquent model — so
its class name can't be used as `model_type`. Name the model instead:

```ts
// config/permission.ts
import { AuthUser } from '@elyvel/auth'
import { definePermissionConfig } from '@elyvel/permission'

export default definePermissionConfig({ userModel: AuthUser })
```

Without it, a request carrying a plain-object user throws with that
instruction rather than guessing — guessing would file those roles under a
different `model_type` than `AuthUser.assignRole()` writes, and they would
silently never match. Apps whose `ctx.user` already IS a model can skip this.

## Caching

The catalogue — every role and permission, and which permissions each role
grants — is cached through [`@elyvel/cache`](/digging-deeper/cache) for 24
hours. Who holds what is not cached; that's read per model, and once per
request when the middleware is in play.

Every write through this package clears the catalogue for you. The one case it
can't see is a write that bypasses it — a raw SQL insert, or attaching through
the relation directly (`role.permissions().attach(...)`). Call
`forgetPermissionCache()` after those.

If the app has no cache configured at all, checks still work — they just read
the tables every time.

## Guards

A role or permission belongs to a guard, exactly like Laravel's `guard_name`,
so one app can hand out an "admin" for the web session and a different "admin"
for API tokens without the two colliding.

The semantics follow spatie precisely, and the asymmetry is intentional:

- **Reading with no guard matches every guard.** `hasRole('admin')` is true for
  an admin under any guard.
- **Naming one narrows it.** `hasRole('admin', 'api')`.
- **Writing defaults** to `permission.defaultGuard` (`web`), because a role has
  to be created under some guard.

## Configuration

Everything has a default; create `config/permission.ts` only to change one:

```ts
import { definePermissionConfig } from '@elyvel/permission'

export default definePermissionConfig({
  defaultGuard: 'web',
  cacheSeconds: 24 * 60 * 60,
  tables: { roles: 'roles', permissions: 'permissions' },
  registerGate: true,
})
```

## Commands

```sh
elyvel permission:migration                                   # generate the migration
elyvel permission:create-permission "edit posts"              # [--guard=web]
elyvel permission:create-role editor --permissions="edit posts,delete posts"
elyvel permission:show                                        # every role and what it grants
```

## Scope

Not included, and called out rather than left as a surprise: spatie's **teams**
feature (multi-tenant role scoping — it doubles the schema, and is config-gated
even there), **wildcard permissions** (`posts.*`), and the role/permission
**events**.
