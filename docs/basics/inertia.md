# Inertia & Vue

Build a classic server-routed app that renders full Vue pages instead of
JSON — no separate API layer, no client-side router, but a fully reactive
SPA-feeling frontend. This is what the `vue` starter kit wires up by
default.

## Server-side setup

Register the plugin once, globally, in `config/middleware.ts`:

```ts
// config/middleware.ts
import { inertia } from '@elyvel/inertia'

export default defineMiddlewareConfig({
  global: [
    inertia({
      vite: { entry: 'frontend/app.ts' },
      ssr: { bundle: 'public/build/ssr/ssr.js' }, // omit if you don't need SSR
    }),
  ],
})
```

Return `Inertia.render(component, props)` from any route or controller
action — `component` is a path under `frontend/Pages/` (no extension):

```ts
route().get('/dashboard', ({ user }) =>
  Inertia.render('Dashboard', { user, stats: computeStats() }))
```

The same handler transparently serves both the initial full-page HTML load
and every subsequent XHR "visit" Inertia's client makes — controllers never
need to branch on which one it is.

## Shared data

Data that should ride along on every page, without every handler repeating
it:

```ts
import { Inertia } from '@elyvel/inertia'

// Outside a request (e.g. top-level in a route file) — a permanent
// baseline for every future request:
Inertia.share('auth', { twoFactorEnabled: authHasPlugin('two-factor') })
```

Calling `Inertia.share()` **during** a request instead scopes it to just
that request — safe under concurrency, never leaks between requests.
Per-request data like the signed-in user is usually just passed as an
explicit prop on each `render()` call rather than shared, since it's
already available on the request context.

## Redirects & validation errors

A failed [FormRequest](/basics/controllers#validating-input)
validation on an Inertia request doesn't return a JSON `422` — Inertia is
always treated as the "web" lane (never the JSON-API lane), so it gets a
`303` redirect back with the errors flashed to the session instead. On the
next page load, `page.props.errors` always reflects those flashed errors
— even during a partial reload with a restrictive `only` list — so
`form.errors.title` in a Vue page just works with no controller-side
branching. See [Session](/digging-deeper/session#flash-data) for the
underlying flash mechanics.

## Partial reloads & lazy props

A partial reload (Inertia requesting only some props on revisit) is
handled automatically via the `only`/`except` headers Inertia's client
sends. Control what's actually evaluated with prop wrappers:

```ts
Inertia.render('Users/Index', {
  users: await User.all(),
  stats: Inertia.defer(() => computeStats()),      // loaded after first paint, not in the initial payload
  feed: Inertia.merge(() => nextPage()),           // appended (not replaced) on the client
  flags: Inertia.always(() => featureFlags()),     // always sent, even if `only` excludes it
  region: Inertia.optional(() => detectRegion()),  // only evaluated when a partial reload explicitly asks for it
})
```

`Inertia.defer`/`.merge`/`.deepMerge`/`.always`/`.optional`/`.once` each
solve a different "don't compute or send this until it's actually needed"
problem — reach for whichever matches. Each factory wraps the callback in
an underlying class (`DeferProp`/`MergeProp`/`AlwaysProp`/`OptionalProp`/
`OnceProp`) if you ever need to inspect or `instanceof`-check a prop value
rather than just produce one.

## History encryption & redirects to another origin

`Inertia.render()` returns a chainable `InertiaResponse` with a few more
per-page controls:

```ts
Inertia.render('Settings/Billing', props)
  .encryptHistory()   // encrypt this page's state in the browser history (e.g. a page showing sensitive data)
  .clearHistory()      // drop all previous history entries (e.g. after logout)
  .preserveFragment()  // keep the URL's #fragment across this visit
```

For a redirect that must leave elyvel's own request/response cycle
entirely (an external URL, or a location Inertia's client can't just
merge into its current page state), use `Inertia.location(url)` instead
of `Inertia.render(...)` — it forces a full browser navigation.

## Asset versioning

```ts
inertia({ version: () => buildManifestHash })
```

When the client's `X-Inertia-Version` header doesn't match, the plugin
responds `409` instead of the usual page payload — Inertia's client
detects this and does a full browser navigation instead of merging state,
so a new deploy's assets always load cleanly instead of a stale SPA
silently running old JS.

## The frontend side

```ts
// frontend/app.ts
import { createInertiaApp } from '@inertiajs/vue3'
import { createApp, h } from 'vue'

createInertiaApp({
  pages: './Pages',
  setup({ el, App, props, plugin }) {
    createApp({ render: () => h(App, props) }).use(plugin).mount(el!)
  },
})
```

Pages live under `frontend/Pages/**/*.vue`, matching the component string
passed to `Inertia.render()` (`Blog/Create` → `frontend/Pages/Blog/Create.vue`).
Layouts live under `frontend/Layouts/`. The `pages: './Pages'` shorthand is
resolved at build time by the official `@inertiajs/vite` plugin, not by
`@elyvel/inertia` itself — that package only injects the right
`<script>`/`<link>` tags into the server-rendered HTML shell.

## Server-side rendering (SSR)

Supported, and wired in the `vue` starter kit — not client-only.
`inertia({ ssr: { bundle: '...' } })` points at a built SSR bundle
(`vite build --ssr`); on a first page load the plugin dynamically imports
it, renders `{ head, body }`, and splices that into the HTML document
instead of an empty mount div. Any SSR render error is swallowed and it
silently falls back to client-only rendering, so a broken SSR bundle never
takes the whole app down.

## File uploads

No special configuration needed. Inertia's client automatically switches a
form submission to `multipart/form-data` when it contains a `File`, and
Elysia parses multipart fields into `File` instances on `ctx.body`
natively — a controller just reads `ctx.body.cover_image instanceof File`
directly, no extra wiring on either side.
