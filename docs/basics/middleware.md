# Middleware

Middleware wraps requests — inspecting or short-circuiting them before they reach
a route, and optionally doing work after the response is sent. It's how auth
guards, CSRF protection, rate limiting, and input normalization are applied.

## Writing middleware

A middleware extends `Middleware` and implements `handle()`. Return a response to
**stop** the request; return nothing to let it **continue**:

```ts
// app/middleware/EnsureTeamMember.ts
import type { MiddlewareContext } from '@elyvel/core'
import { Middleware } from '@elyvel/core'

export class EnsureTeamMember extends Middleware {
  handle(ctx: MiddlewareContext) {
    if (!ctx.user?.teamId)
      return ctx.status(403, { message: 'You are not on a team.' })
    // returning nothing → continue to the route
  }
}
```

Generate one with `bunx elyvel make:middleware EnsureTeamMember`.

The context is the request context — `request`, `params`, `query`, `body`,
`set`, `status()`, plus anything earlier middleware derived (e.g. `user`).

## Registering middleware

Middleware is wired in `config/middleware.ts` with `defineMiddlewareConfig`,
which has three buckets:

```ts
// config/middleware.ts
import { defineMiddlewareConfig, TrimStringsMiddleware } from '@elyvel/core'
import { AuthGuard, VerifiedGuard } from '@elyvel/auth'
import { EnsureTeamMember } from '../app/middleware/EnsureTeamMember'

export default defineMiddlewareConfig({
  // Runs on every request, in order.
  global: [TrimStringsMiddleware],

  // Named middleware, assignable per route via `{ middleware: 'name' }`.
  aliases: {
    auth: AuthGuard,
    verified: VerifiedGuard,
    team: EnsureTeamMember,
  },

  // Named bundles, applied with `.use(group('name'))`.
  groups: {
    admin: ['auth', 'team'],
  },
})
```

## Global middleware

Anything in `global` runs on every request, in order — use it for concerns that
apply app-wide. The `fullstack-vue` example ships a `SetLocale` global that picks
the request's language from `?lang=` or the `Accept-Language` header:

```ts
import { Middleware, type MiddlewareContext } from '@elyvel/core'
import { setRequestLocale } from '@elyvel/i18n'

const SUPPORTED = ['en', 'id']

export class SetLocale extends Middleware {
  handle(ctx: MiddlewareContext): void {
    const fromQuery = typeof ctx.query.lang === 'string' ? ctx.query.lang : undefined
    const fromHeader = ctx.request.headers.get('accept-language')?.split(',')[0]?.trim().slice(0, 2)
    const locale = fromQuery ?? fromHeader
    if (locale && SUPPORTED.includes(locale))
      setRequestLocale(locale)
  }
}
```

Registered in `global`, it makes every response — validation errors included —
come back in the chosen language (`?lang=id` → Indonesian).

## Assigning middleware to routes

Reference an alias by name on a route — one, or a list:

```ts
route()
  .get('/dashboard', handler, { middleware: 'auth' })
  .delete('/posts/:id', handler, { middleware: ['auth', 'team'] })
```

Apply middleware to **every** route in a file by passing it to `route()`:

```ts
route('/admin', { middleware: ['auth'] })
  .get('/users', listUsers)
  .get('/settings', settings)
```

## Attaching middleware on a controller

Besides `{ middleware }` on `route()`/`resource()`, a controller can declare its
own middleware with `@UseMiddleware`/`@WithoutMiddleware` decorators — on a
method (that action only) or the class (every action). They're merged with
whatever the route registration adds, not replaced by it:

```ts
import { Controller, UseMiddleware, WithoutMiddleware } from '@elyvel/core'

@UseMiddleware('auth', 'subscribed')
export class PostController extends Controller {
  @WithoutMiddleware('subscribed') // only 'auth' applies here
  async index(ctx: MiddlewareContext) { /* ... */ }
}
```

See [Routing](/basics/routing#controller-level-middleware-authorization--validation)
for the full picture alongside `@Authorize`/`@ValidateWith`, and for adjusting a
`resource()`'s middleware fluently after registration
(`.middleware()`/`.middlewareFor()`/`.withoutMiddlewareFor()`).

## Middleware parameters

An alias can take arguments after a colon; they arrive as trailing string
parameters on `handle()`:

```ts
route().post('/otp', handler, { middleware: 'throttle:5,1' })
```

```ts
export class ThrottleMiddleware extends Middleware {
  handle(ctx: MiddlewareContext, max: string, minutes: string) {
    // max === '5', minutes === '1'
  }
}
```

## Groups

Bundle several middleware under a name in `groups`, then apply the bundle with
`.use(group('name'))`. Group entries may be middleware classes, alias names, or
raw Elysia plugins:

```ts
import { group, route } from '@elyvel/core'

export default route()
  .use(group('admin')) // ['auth', 'team']
  .get('/reports', reports)
```

## Built-in middleware

The framework seeds a few out of the box (your `config/middleware.ts` can
override them):

| Name | Kind | What it does |
| --- | --- | --- |
| `csrf` (`CsrfMiddleware`) | alias | Verifies the CSRF token on state-changing requests. |
| `throttle` (`ThrottleMiddleware`) | alias | Rate-limits by IP: `throttle:max,minutes`. |
| `web` | group | Bundles `csrf` — apply to browser/session routes. |

Two input-normalizers (Laravel's `TrimStrings` / `ConvertEmptyStringsToNull`) are
exported for you to add to `global`:

```ts
import { ConvertEmptyStringsToNullMiddleware, TrimStringsMiddleware } from '@elyvel/core'

global: [TrimStringsMiddleware, ConvertEmptyStringsToNullMiddleware]
```

The `web` group is a group, not a global, so CSRF applies only where you opt in —
API/token routes stay CSRF-immune. Redefine `web` in your config to change it.

## Rate limiting

`throttle:max,minutes` (shown above) is the simple, per-client-IP form. For
named, reusable limiters — different limits per user vs. per IP, custom
responses, only counting failed attempts — register one with `RateLimiter.for`
(Laravel's `RateLimiter::for`), typically in a service provider's `boot()`:

```ts
import { Limit, RateLimiter } from '@elyvel/core'

RateLimiter.for('otp', ctx =>
  Limit.perMinute(5)
    .by(ctx.user?.email ?? ctx.request.headers.get('x-forwarded-for') ?? 'guest')
    .response(ctx => ctx.status(429, { message: 'Too many OTP requests.' })),
)
```

Then reference it by name instead of `max,minutes`:

```ts
route().post('/otp', handler, { middleware: 'throttle:otp' })
```

`Limit` builders: `perSecond`/`perMinute`/`perMinutes`/`perHour`/`perDay`/`none`
(unlimited), `.by(key)` (segment by user id, email, anything), `.response(cb)`
(custom response when exceeded), `.after(cb)` (only count the attempt when the
response status matches — e.g. count only failed login attempts).

The `RateLimiter` facade also has direct, programmatic methods for driving your
own logic — `attempt`, `hit`, `increment`, `tooManyAttempts`, `remaining`,
`retriesLeft`, `resetAttempts`/`clear`, `availableIn` — the same primitives the
middleware itself uses.

By default the client key is the real socket peer address, not
`X-Forwarded-For`/`X-Real-IP` (spoofable by the client otherwise). Behind a
proxy/load balancer that sets those headers, opt in with `trustProxies()`:

```ts
import { trustProxies } from '@elyvel/core'

trustProxies() // now X-Forwarded-For / X-Real-IP are trusted
```

## After-response work

Implement `terminate()` to run work *after* the response is sent — logging,
metrics, cleanup. Its return value is ignored, and it can't change the response:

```ts
export class RequestLogger extends Middleware {
  handle() {}
  terminate(ctx: MiddlewareContext) {
    logger.info('request', { path: new URL(ctx.request.url).pathname })
  }
}
```
