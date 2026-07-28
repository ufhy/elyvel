# Views

A view here is a plain TypeScript function, not a compiled template file —
`html` is a tagged template literal that auto-escapes interpolated values,
with no separate template language or `.html`/`.eta` file convention to
learn.

::: tip When to reach for this
`@elyvel/view` is for mail bodies, custom error pages, and small
first-party server-rendered screens (dashboards, health/status pages) —
not the primary UI layer. The flagship examples (`fullstack-vue`,
`spa-vue`) use Inertia + Vue for their actual frontend; reach for that when
you want a full reactive SPA instead of plain server-rendered HTML.
:::

## Writing a view

```ts
// app/views/dashboard.ts
import { html } from '@elyvel/view'
import type { ViewTemplate } from '@elyvel/view'

interface DashboardProps {
  pending: number
  failed: { id: string, error: string }[]
}

const dashboard: ViewTemplate<DashboardProps> = (props, shared) => html`
  <h1>Dashboard</h1>
  <p>${props.pending} jobs pending</p>
  <ul>
    ${props.failed.map(job => html`<li>${job.id}: ${job.error}</li>`)}
  </ul>
`

export default dashboard
```

```ts
// routes/web.ts
import { view } from '@elyvel/view'
import dashboard from '../app/views/dashboard'

route().get('/dashboard', () => view(dashboard, { pending: 3, failed: [] }))
```

`view(template, props)` returns a response object the framework knows how
to render — return it directly from a handler. Chain `.status(code)` to
set an explicit HTTP status.

## Composition (no separate layout syntax)

There's no `@extends`/`@yield`/child-template mechanism — layouts are just
a function that takes a body and wraps it:

```ts
import type { Html } from '@elyvel/view'

function layout(title: string, body: Html): Html {
  return html`<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`
}

const page: ViewTemplate<{ name: string }> = props =>
  layout('Welcome', html`<h1>Hi ${props.name}</h1>`)
```

Nested `html` fragments and arrays render in place — an array of `html`
results (from `.map()`) is rendered element-by-element, which is how loops
work (see below). This is plain function composition, not a templating
feature — include a "partial" by calling the function that builds it and
interpolating the result.

## Control flow

No `@if`/`@foreach` — just TypeScript:

```ts
html`
  ${shared.errors.email ? html`<p class="err">${shared.errors.email[0]}</p>` : ''}
  <ul>${items.map(item => html`<li>${item.name}</li>`)}</ul>
`
```

A falsy interpolated value (`null`/`false`/`undefined`) renders as nothing,
so `condition && html\`...\`` works safely too.

## Escaping

Every plain interpolated value is HTML-escaped automatically — this is the
only path for values coming from user input, so there's no way to
accidentally render unescaped text. To output trusted HTML verbatim (e.g.
HTML entities in pagination link labels), opt out explicitly:

```ts
import { raw } from '@elyvel/view'

html`<span>${raw('&laquo; Previous')}</span>`
```

Use `raw()` sparingly and never on user-controlled input.

## Shared data

Two different kinds of "shared" exist, and they're not the same thing:

**Framework-injected, per-request** — `shared.errors`, `shared.old(key,
fallback)`, `shared.flash(key, fallback)`, `shared.csrf` are built from the
current session automatically (Laravel's `$errors`/`old()`/CSRF-field
conventions, as plain values/functions instead of Blade globals):

```ts
html`
  <input name="email" value="${shared.old('email', '')}">
  ${shared.errors.email ? html`<p>${shared.errors.email[0]}</p>` : ''}
  <input type="hidden" name="_token" value="${shared.csrf}">
`
```

**App-configured, process-wide** — `View.share(key, value)` for data
that's the same for every request (app name, a feature flag), available
under `shared.globals`:

```ts
import { View } from '@elyvel/view'

View.share('appName', 'Elyvel')
View.share('year', () => new Date().getFullYear()) // resolved lazily on each render
```

::: warning Not per-request
`View.share()` is process-wide, not per-request-isolated — only use it for
values genuinely identical across every user. Anything user- or
request-specific belongs in `view(template, props)`'s own props instead.
:::

Two small helpers build common hidden form fields from `shared`:
`csrfField(shared)` and `methodField('DELETE')` (for HTML forms, which
don't support PUT/PATCH/DELETE natively).

## Mail integration

`Message.html(...)` in `@elyvel/mail` accepts anything with a `render()`
method, so a view renders straight into an email body:

```ts
message.html(view(welcomeEmailTemplate, { name: user.name }))
```

Since mail sends outside an HTTP request, `shared` there has no real
session — `errors`/`old`/`flash`/`csrf` come through as empty defaults.

## Pagination links

Render prev/next + windowed page-number links for an
[Eloquent paginator](/database/eloquent#pagination):

```ts
import { paginationLinks } from '@elyvel/view'

const page = await Post.query().orderBy('id').paginate(15, currentPage)

html`
  <ul>${page.data.map(post => html`<li>${post.title}</li>`)}</ul>
  ${paginationLinks(page, { path: '/posts', window: 2 })}
`
```

`window` controls how many page numbers show on each side of the current
page (default 2). Anything with `currentPage`/`lastPage` fields works —
not just the exact `Paginator` type — so a `simplePaginate()`/custom
pagination shape can be adapted to fit.

## Custom error pages

The framework's default error pages (404, 500, the dev-only debug page)
are built in and don't use this package. To render your own with `view()`,
hook in via `configureErrorPage`:

```ts
import { configureErrorPage } from '@elyvel/core'
import { view } from '@elyvel/view'

configureErrorPage((status, { message }) =>
  status === 404 ? view(notFoundPage, { message }) : undefined)
```

Returning `undefined` for a status falls back to the built-in page.

## Testing

A view is a plain function — render it directly and assert on the string:

```ts
const shared = { errors: {}, old: () => '', flash: () => '', csrf: 'x', globals: {} }

const output = view(dashboard, { pending: 3, failed: [] }).render(shared)

expect(output).toContain('3 jobs pending')
```

Call `View.flushShared()` before/after a test that uses `View.share(...)`
— the shared-data map is process-lifetime, not reset between tests
automatically.
