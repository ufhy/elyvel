## Authentication (@elyvel/auth)

- Auth is **Better Auth** underneath, mounted at `/api/auth/*` by
  `betterAuthPlugin()` in `config/middleware.ts`. Do not hand-roll login,
  registration, or session endpoints — they already exist there.
- `ctx.user` is derived globally and is a **plain object**, not an Eloquent
  model. To query the user's rows, use the `AuthUser` model (or the app's own
  model extending it).
- Route guards: `{ middleware: 'auth' }` requires a user, `'verified'` also
  requires a verified email. Browser navigations redirect to the login page;
  JSON requests get 401.
- Authorization (may this user do X to this record?) is `Gate` and policies —
  `elyvel make:policy`. Gate is **synchronous**: an ability returning a Promise
  throws, so never make a policy method `async`.
- Passwords: `Hash.make(plain)` and `Hash.verify(plain, hashed)` — over Bun's
  native argon2id. There is no `check`. In tests, `actingAs(user)`.
- Changing enabled Better Auth plugins changes the schema — re-run
  `elyvel auth:generate-migration-plugin`, then migrate.
