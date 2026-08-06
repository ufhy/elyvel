# Request Lifecycle

Knowing the order things happen in is what turns "why is my session empty in
this hook?" from a mystery into a lookup. This page is that lookup.

## Boot

`Application.create()` (called by `server.ts`) runs once, in this order:

1. **Config** — every file in `config/` is loaded; `.env` is already applied.
2. **Logger** — channels built from `config/logging.ts`; the encryption key and
   URL-signing key are set from `app.key`.
3. **Maintenance mode** — the earliest guard: an outage short-circuits every
   request before anything else runs.
4. **Request context** — correlation id, per-request logger,
   [Context](/digging-deeper/context) scope, actor scope.
5. **Middleware registry** — aliases and groups from `config/middleware.ts`.
6. **Response normalisation** — redirects, files, views (see
   [Responses](/basics/responses)). Mounted before the session so flashes land
   before the session persists.
7. **Session** — cookie or server-side store, CSRF.
8. **Error pages** — after the session, so a 422 redirect-back wins before an
   error page renders.
9. **Timezone**, then **OpenAPI** (before routes, so the plugin observes them all).
10. **Service providers** — discovered package providers first (from
    `bootstrap/providers.generated.ts`), then `config/app.ts`'s list. Each
    `register()` runs, then routes load from `routes/`, then each `boot()`.

Then `listen()` starts the server.

## One request

```
request
  → maintenance check
  → request context (id, log, Context/actor scopes open)
  → global middleware (config/middleware.ts `global`)
  → group middleware (`web` → session + CSRF, `api`, …)
  → route middleware
  → route handler                ← your code
  → response normalisation (redirect/file/view/JSON)
  → terminators (middleware `terminate()`, after the response)
```

Two consequences worth knowing:

- **Session exists only inside the `web` group** (or wherever you mounted it).
  A handler outside it has no `ctx.session`.
- **`@WithoutMiddleware`** strips a middleware wherever it came from — route,
  group, or global — matching Laravel's `->withoutMiddleware()`.

## Errors

An uncaught error runs through one pipeline: log it (with the request's
correlation id) → give the session a chance to redirect back (422 validation) →
render, honouring `Accept` (JSON for API clients, an error page for browsers)
and `app.debug` for the trace. Details:
[Error handling](/basics/error-handling).
