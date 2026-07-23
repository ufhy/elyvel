# Authentication

elyvel's authentication is powered by [Better Auth](https://www.better-auth.com)
running on the framework's Eloquent adapter, wrapped so it feels like the rest of
the framework: **every auth flow is validated through a FormRequest**, errors come
back in the same translated `{ message, errors }` envelope as any other request,
and each flow's rules can be swapped without touching a single route.

## Configuration

Authentication is configured in `config/auth.ts` with **native Better Auth
options** — the framework only fills in glue (the Eloquent adapter, a secret
derived from `APP_KEY`, the base URL, cookie prefix, and plural table names).

```ts
// config/auth.ts
import { defineAuthConfig } from '@elyvel/auth'
import { twoFactor } from 'better-auth/plugins'

export default defineAuthConfig({
  // Which endpoints are exposed (see “Features” below).
  features: {
    registration: true,
    passwordReset: true,
    emailVerification: true,
  },

  // Native Better Auth options — the Better Auth docs apply directly here.
  plugins: [twoFactor()],
  emailAndPassword: { enabled: true, requireEmailVerification: false },
})
```

## Mounting

Better Auth is mounted once, as global middleware, in `config/middleware.ts`:

```ts
// config/middleware.ts
import { betterAuthPlugin } from '@elyvel/auth'

export default defineMiddlewareConfig({
  global: [
    betterAuthPlugin(), // mounts /api/auth/*, derives `user`, adds guard macros
    // …
  ],
})
```

`betterAuthPlugin()` takes only HTTP-wiring options — `{ instance?, basePath? }`.
The Better Auth instance is resolved lazily from the container, so route files
never import it. In your route files, `webRoute()` gives you a router with the
authenticated `user` already typed in context.

## Protecting routes

Use the `auth` and `verified` middleware — the equivalents of Laravel's `auth`
and `verified`:

```ts
// routes/web.ts
webRoute()
  .get('/dashboard', ({ user }) => Inertia.render('Dashboard', { user }), {
    middleware: ['auth'],
  })
  .get('/billing', ({ user }) => /* … */, { middleware: ['verified'] })
```

- **`auth`** — requires a signed-in user. A browser navigation is redirected to
  the login page; an API/JSON request gets a `401`.
- **`verified`** — also requires a verified email; unverified browsers are sent
  to the verify-email notice, API requests get a `403`.

The redirect targets come from `config/auth.ts` — a single source shared by the
guards:

```ts
export default defineAuthConfig({
  loginPath: '/login', // where guests are sent (default)
  verifyPath: '/verify-email', // where unverified users are sent (default)
})
```

### The authenticated user

Inside any route handler, `ctx.user` is the signed-in user (or `null`), and the
gate helpers are bound to them:

```ts
webRoute().get('/posts/:id/edit', (ctx) => {
  ctx.authorize('update', post) // throws 403 if the policy denies
  return Inertia.render('Posts/Edit', { post, user: ctx.user })
}, { middleware: ['auth'] })
```

`ctx.can(ability, …)`, `ctx.cannot(…)`, and `ctx.authorize(…)` are available too.

## Validating & customizing each flow

Every auth flow is validated by a **FormRequest**, exactly like the rest of the
framework. The default requests ship with the framework; you swap any of them
through the `AuthActions` registry (Laravel Fortify's `createUsersUsing` analog)
in a service provider's `boot()`:

| Flow | Endpoint | Swap with |
| --- | --- | --- |
| Registration | `POST /api/auth/sign-up/email` | `AuthActions.registerUsing()` |
| Login | `POST /api/auth/sign-in/email` | `AuthActions.loginUsing()` |
| Password reset | `POST /api/auth/reset-password` | `AuthActions.resetPasswordUsing()` |
| Change password | `POST /api/auth/change-password` | `AuthActions.updatePasswordUsing()` |
| Update profile | `POST /api/auth/update-user` | `AuthActions.updateProfileUsing()` |

Validation runs whether the endpoint is hit over HTTP **or** called
programmatically via `auth.api.*` — so a custom route that calls the server API
is validated too.

### Example: require password confirmation on registration

```ts
// app/requests/RegisterRequest.ts
import type { Rules } from '@elyvel/validation'
import { FormRequest, Password } from '@elyvel/validation'

export class RegisterRequest extends FormRequest {
  rules(): Rules {
    return {
      name: 'required|string|max:255',
      email: 'required|email',
      // `confirmed` requires a matching `password_confirmation` field.
      password: ['required', 'string', 'confirmed', Password.default()],
    }
  }
}
```

```ts
// app/providers/AppServiceProvider.ts
import { AuthActions } from '@elyvel/auth'
import { RegisterRequest } from '../requests/RegisterRequest'

export class AppServiceProvider extends ServiceProvider {
  boot(): void {
    AuthActions.registerUsing(RegisterRequest)
  }
}
```

A failed rule returns the framework's standard `422`:

```json
{
  "message": "The name field is required. (and 1 more error)",
  "errors": {
    "name": ["The name field is required."],
    "password": ["The password confirmation does not match."]
  }
}
```

::: tip
The `confirmed` rule reports a mismatch on the **`password`** field (matching
Laravel), so render that error under your password input, not the confirmation
input.
:::

## Password policy

Define your password rules **once** with `Password.defaults()` — Laravel's
`Password::defaults()`. It governs registration, password reset, and
change-password alike, and Better Auth's own `minPasswordLength` is kept in sync
with it automatically.

```ts
// app/providers/AppServiceProvider.ts
import { Password } from '@elyvel/validation'

boot(): void {
  Password.defaults(() =>
    this.app.config.get('app.env') === 'production'
      ? Password.min(10).mixedCase().numbers().uncompromised()
      : Password.min(8),
  )
}
```

`uncompromised()` checks the password against the Have I Been Pwned breach
corpus (k-anonymity — only a SHA-1 prefix is ever sent, and it fails open if the
service is unreachable).

## Features — closing endpoints

The `features` map controls which auth endpoints are exposed. A disabled feature
becomes a **real `404`** (not an existing-but-forbidden route), so it's
indistinguishable from a route that was never registered.

```ts
export default defineAuthConfig({
  features: {
    registration: false, // no public sign-up endpoint
    passwordReset: true,
    emailVerification: true,
    // signIn, socialSignIn, signOut, sessions, changeEmail,
    // updatePassword, updateProfile, accounts, deleteUser …
  },
})
```

Gating is HTTP-only: **`auth.api.*` still works** even when a feature's public
route is closed. That gives you two clean patterns:

- **Invite-only** — set `registration: false`, then create users server-side
  (from an admin screen, an invite flow, a seeder) with `auth.api.signUpEmail`.
- **Bring-your-own registration URL** — set `registration: false`, then define
  your own `POST /register` route that calls `auth.api.signUpEmail` — no dangling
  default endpoint left exposed.

```ts
// routes/auth.ts — a fully custom registration endpoint
webRoute().post('/register', async ({ body }) => {
  return app(AuthToken).api.signUpEmail({ body, asResponse: true })
})
```

::: tip Disable vs close
`features.registration: false` closes the **public route** but keeps the
programmatic API. To disable registration *entirely* (even server-side), use
Better Auth's own `emailAndPassword.disableSignUp: true` instead.
:::

## Extra registration fields

Declare additional user fields with Better Auth's native `additionalFields`;
they're persisted and validated by Better Auth, and you can validate them in your
FormRequest for translated, framework-shaped errors:

```ts
export default defineAuthConfig({
  user: {
    additionalFields: {
      company: { type: 'string', required: false },
    },
  },
})
```

Any body key that isn't a declared field (e.g. `password_confirmation`) is simply
ignored by the sign-up API — it never causes a "field not allowed" error.

## Rate limiting

Better Auth rate-limits the auth routes (sign-up/sign-in default to ~3 requests
per 10 seconds), enabled in production. To enforce it in every environment or
tune it per path, set `rateLimit` in `config/auth.ts`:

```ts
export default defineAuthConfig({
  rateLimit: { enabled: true },
})
```

## Error responses

Better Auth's raw, coded errors are normalized into the framework's single
translated envelope before they reach the client:

```json
{ "message": "These credentials do not match our records." }
```

Field-level failures (a duplicate email, a weak password) come back as a `422`
with an `errors` bag keyed by field — the same shape every validated request in
elyvel produces, and translated through the `auth::` and `validation::` language
namespaces.
