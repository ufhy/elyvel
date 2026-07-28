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

### Adding a plugin after you've already migrated

Enabling a new plugin (e.g. `username()`) on an app that has already run its
first migration is safe: `migrateBetterAuth` (used by the migration that
creates Better Auth's tables) is **idempotent and incremental** — an
already-existing table is left alone except for any columns the new plugin
adds, and a wholly new plugin table (e.g. `twoFactor()`'s own `twoFactor`
table) gets created.

1. Add the plugin to `config/auth.ts` by hand (import it from
   `better-auth/plugins`, add it to `plugins: [...]`).
2. Run `elyvel auth:generate-migration-plugin` — no name to invent, it
   generates a migration that re-runs `migrateBetterAuth`.
3. `elyvel migrate`.

```ts
// config/auth.ts
import { twoFactor, username } from 'better-auth/plugins'

export default defineAuthConfig({
  plugins: [twoFactor(), username()], // username() added later
})
```

### The Eloquent adapter

The "glue" `defineAuthConfig` fills in is `eloquentAdapter()` — a Better
Auth database adapter that runs every Better Auth DB operation through
elyvel's own `table()` query builder on the app's default connection, so
there's no separate ORM/connection just for auth. You never call it
directly through `defineAuthConfig`; it's only worth importing yourself if
you're constructing a `betterAuth({...})` instance by hand outside that
helper:

```ts
import { eloquentAdapter } from '@elyvel/auth'
import { betterAuth } from 'better-auth'

betterAuth({
  database: eloquentAdapter(),
  emailAndPassword: { enabled: true },
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

### Eloquent models for the auth tables

Better Auth's own tables are exposed as real Eloquent models — so you can
query and relate to them like any other table in the framework, not just poke
a bare `user_id` column:

```ts
import { AuthUser } from '@elyvel/auth'

const user = await AuthUser.find(id)
const accounts = await user.accounts().get() // hasMany(AuthAccount, 'user_id')
const sessions = await user.sessions().get() // hasMany(AuthSession, 'user_id')
```

| Model | Table | Notes |
| --- | --- | --- |
| `AuthUser` | `users` | `accounts()`, `sessions()` relations. |
| `AuthAccount` | `accounts` | One row per linked sign-in method (password, each OAuth provider). `user()` belongs to `AuthUser`. Hides `access_token`/`refresh_token`/`id_token`/`password`. |
| `AuthSession` | `sessions` | One row per active login session. `user()` belongs to `AuthUser`. Hides `token`. |
| `AuthVerification` | `verifications` | Email verification / password reset tokens, keyed by `identifier` (e.g. an email) — no FK to `users`. |

Only the fields Better Auth always has are declared/typed. A plugin's own
extra field on `users` (e.g. `twoFactor()`'s `twoFactorEnabled`) is still a
real attribute on the row — `declare` it yourself in a subclass if you want it
typed:

```ts
// app/models/User.ts
import { AuthUser } from '@elyvel/auth'
import { Post } from './Post'

export class User extends AuthUser {
  declare twoFactorEnabled: boolean

  posts() {
    return this.hasMany(Post, 'user_id')
  }
}
```

::: tip Subclassing limitation
A relation defined on the base class — `AuthAccount.user()` →
`belongsTo(AuthUser, ...)` — still hydrates as the base `AuthUser`, not your
`User` subclass, even though the row is identical. If you need that upgraded,
subclass `AuthAccount`/`AuthSession` too and override `user()` to point at
your own `User` class.
:::

Better Auth's own fields are camelCase (`emailVerified`, `userId`, …); elyvel
remaps every core field to its snake_case column name (`email_verified`,
`user_id`, …) to match every other table in the framework. This only changes
the stored column name — Better Auth's own JS-level API (`ctx.user.emailVerified`,
`session.userId`) is completely unaffected. A plugin's own additional field on
a core table (e.g. `twoFactor()`'s `twoFactorEnabled`) is **not** remapped and
stays camelCase.

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

## Email verification

Provide a mailer callback in `config/auth.ts`; Better Auth sends the
verification link (on sign-up by default):

```ts
export default defineAuthConfig({
  emailAndPassword: { requireEmailVerification: true },
  emailVerification: {
    sendVerificationEmail: ({ user, url }) =>
      Mail.to(user.email).subject('Verify your email').html(`<a href="${url}">Verify</a>`).send(),
  },
})
```

With `requireEmailVerification: true`, an unverified user can't sign in and the
`verified` guard sends them to `verifyPath`. Resend the link from the client:

```ts
authApi.sendVerification(email, callbackURL) // POST /api/auth/send-verification-email
```

## Password reset

Provide the reset mailer, then drive the two-step flow from the client:

```ts
export default defineAuthConfig({
  emailAndPassword: {
    sendResetPassword: ({ user, url }) =>
      Mail.to(user.email).subject('Reset your password').html(`<a href="${url}">Reset</a>`).send(),
  },
})
```

```ts
authApi.requestPasswordReset(email, redirectTo) // emails a reset link
authApi.resetPassword(newPassword, token)        // sets the new password
```

`resetPassword` runs through `ResetPasswordRequest`, so the app-wide
`Password.defaults()` policy applies here too.

## Two-factor authentication

Enable the `twoFactor()` plugin in `config/auth.ts`:

```ts
import { twoFactor } from 'better-auth/plugins'

export default defineAuthConfig({ plugins: [twoFactor()] })
```

`authHasPlugin('two-factor')` lets you feature-gate the UI. Enrollment and
challenge run through the client:

```ts
authApi.enableTwoFactor(password)   // → { totpURI, backupCodes } — show the QR
authApi.verifyTotp(code)            // confirm enrollment / clear a sign-in challenge
authApi.verifyBackupCode(code)      // use a backup code instead
authApi.disableTwoFactor(password)
authApi.generateBackupCodes(password)
```

When 2FA is enabled, a sign-in returns a two-factor challenge; complete it with
`verifyTotp` (or `verifyBackupCode`) before the session is established.

## Social sign-in

Providers are opt-in — a button appears only when its credentials are present
(typically wired from env):

```ts
export default defineAuthConfig({
  socialProviders: {
    github: { clientId: process.env.GITHUB_CLIENT_ID!, clientSecret: process.env.GITHUB_CLIENT_SECRET! },
  },
})
```

`enabledSocialProviders(auth)` returns the active providers so you can render the
right buttons. Kicking off the flow returns the OAuth URL to redirect to:

```ts
const { data } = await authApi.signInSocial('github', '/dashboard') // → { url }
```

## Sessions & signing out

The signed-in user comes from the session cookie; `ctx.user` is derived from it
on every request. Sign out and manage sessions from the client:

```ts
authApi.signOut() // POST /api/auth/sign-out
```

Session management endpoints (`list-sessions`, `revoke-session`,
`revoke-sessions`, `revoke-other-sessions`) are gated by `features.sessions`.

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

## Testing

Sign in as a specific user without going through the real Better Auth flow —
see [HTTP Tests](/digging-deeper/testing#acting-as-a-user) for the full
`actingAs()`/`stopActingAs()`/`actingAsGuest()` testing seam.

## Password hashing

`Hash` wraps Bun's native `Bun.password` (argon2id by default, constant-time
verification) — the same primitive Better Auth itself uses under the hood,
available directly if you ever need to hash/verify a password outside the
auth flow:

```ts
import { Hash } from '@elyvel/auth'

const hashed = await Hash.make('a-plaintext-password')
await Hash.verify('a-plaintext-password', hashed) // boolean
```

## Standalone token auth (advanced)

For a minimal API-token guard that doesn't need sessions/2FA/social
login — a machine-to-machine or mobile-client API — `AuthManager` is a
lighter-weight, independent alternative to `betterAuthPlugin()`. The two
don't compose; pick one per app:

```ts
import { createAuth } from '@elyvel/auth'

const auth = createAuth({
  provider: myUserProvider,   // retrieveById / retrieveByCredentials / validateCredentials
  tokens: myTokenStore,        // store / findUserId / revoke (hashed tokens only)
  maxAttempts: 5,               // failed-login lockout, keyed by email
  decayMinutes: 1,
})

const { user, token } = await auth.attempt({ email, password }) ?? {}
// throws TooManyAttemptsError on lockout; returns null on bad credentials

app.use(auth.guard()) // derives `user`/`authToken`, adds the `auth` macro
```

You implement `UserProvider`/`TokenStore` yourself over your own model —
this stays storage-agnostic by design.
