# Standalone SPA (no Inertia)

For a fully client-side-routed frontend (Vue/React/Svelte + your own
router) backed by a plain JSON API instead of Inertia — the pattern the
`spa` starter kit uses.

## Usage

```ts
// routes/web.ts
import { route } from '@elyvel/core'
import { spa } from '@elyvel/vite'

export default route().use(
  spa({ entry: 'frontend/app.ts', title: 'My App', prefix: '/' }),
)
```

This mounts the built (or dev-server) Vite assets and returns the SPA
shell — a bare HTML document with the right `<script>`/`<link>` tags — for
every route under `prefix`, so client-side navigation and deep links
(`/dashboard/settings` loaded directly) both work. Pair it with your own
JSON API on a separate prefix (typically `/api`, using
[Resource](/basics/controllers) transforms + Bearer-token auth) — `spa()`
handles the frontend shell only, not your data endpoints.

## Options

```ts
spa({
  entry: 'frontend/app.ts',     // client entry point
  prefix: '/',                  // where the SPA is mounted; default root
  rootId: 'app',                // element id the client mounts on
  buildDir: 'public/build',     // built assets directory
  title: 'My App',              // <title> for the shell
  head: faviconHtml + themeScript, // extra <head> HTML before the Vite tags
  assets: true,                 // serve buildDir at `base` — false if another route already does
})
```

`html(opts)` overrides the shell document entirely if the default isn't
enough:

```ts
spa({
  entry: 'frontend/app.ts',
  html: ({ head, rootId, title }) => `<!doctype html><html>...</html>`,
})
```

## How deep links work

A client-side route like `/dashboard/settings` has no matching server
route, so it would normally 404. `spa()` hooks into
[`configureErrorPage`](/digging-deeper/views#custom-error-pages): any 404
that isn't under `/api` or the assets `base` gets the SPA shell instead of
a real 404 page, letting the client-side router take over and render the
right view. API 404s and asset 404s are unaffected — this fallback only
catches HTML navigations.

## Dev server vs. built assets

Which of the two gets emitted is decided by one thing: whether the Vite dev
server is running *right now*. It says so itself, by writing `public/hot`
while it lives — add the plugin to `vite.config.ts` and that is the whole
setup:

```ts
// vite.config.ts
import { elyvel } from '@elyvel/vite/plugin'

export default defineConfig({
  plugins: [elyvel(), /* ... */],
})
```

The file holds the dev server's URL including Vite's `base`; the backend
appends only the asset path. It is removed when the process exits or is
signalled, so the moment you stop `vite`, built assets take over again. This
is the same file, in the same place, as Laravel's Vite integration.

::: warning It used to be APP_ENV — and that was a bug
The decision used to come from `APP_ENV`/`NODE_ENV`, which answers a
different question. A production deploy with `APP_ENV` unset served
`http://localhost:5173/...` asset URLs to real visitors: the page rendered,
every asset 404'd in the browser, and the server logged nothing. With no hot
file and no build manifest you now get a loud error instead.
:::

In tests that render pages without a build, call `withoutVite()` — Laravel's
helper of the same name — and the tags come back empty instead of throwing:

```ts
import { withoutVite } from '@elyvel/vite'

withoutVite()
```

`devUrl` still forces dev tags for setups the dev server can't describe
itself — a container publishing a different host, a tunnel.

## Relationship to Inertia

`spa()` and [`inertia()`](/basics/inertia) solve the same "serve a Vite
frontend" problem two different ways: `inertia()` renders server-driven
pages with props (no separate JSON API, no client-side router needed for
data), while `spa()` serves a static shell and leaves routing/data
fetching entirely to the client. Both share the same underlying
`viteTags()`/`ViteOptions` primitive for emitting dev-server vs.
production-manifest asset tags — pick one approach per app, not both.
