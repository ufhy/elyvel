# Localization

Translate strings, with pluralization and placeholder substitution, from
per-locale files — plus a namespaced convention that lets any `@elyvel/*`
package ship its own translatable messages.

## Configuration

```ts
// config/i18n.ts
import { defineI18nConfig } from '@elyvel/i18n'

export default defineI18nConfig({
  locale: process.env.APP_LOCALE ?? 'en',
  fallback: 'en',
  path: 'lang', // default
})
```

There's no separate "supported locales" list in the config — if you
restrict which locales are selectable (say, from a query param or header),
enforce that yourself where you set the locale (see
[Setting the locale](#setting-the-locale) below).

## Translation files

```ts
// lang/en/messages.ts
export default {
  greeting: 'Hello :Name',
  apples: '{0} No apples|[1,19] :count apple(s)|[20,*] Many apples',
}
```

```ts
// lang/id/messages.ts
export default {
  greeting: 'Halo :Name',
}
```

- `lang/<locale>/<group>.ts` → keys resolve as `<group>.<key>` (e.g.
  `messages.greeting`).
- `lang/<locale>.ts` (no subfolder) → whole-sentence keys with no group
  prefix, for `__('I love programming.')`-style usage.
- `lang/vendor/<namespace>/<locale>/<file>.ts` → overrides a **package's**
  translations from your own app (see below).

Each file is a plain TypeScript/JavaScript module with a default-exported
object — no JSON files.

## Package-shipped translations

Any `@elyvel/*` package can ship its own `lang/` directory; its lines are
loaded into a separate namespace and referenced as `<package>::<key>`:

```ts
trans('broadcasting::errors.unauthorized', {}, 'Unauthorized')
```

The third argument is an English fallback used if no translator is
installed at all, or the key resolves nowhere — this is how framework
packages (validation, auth, broadcasting) produce translated messages
without depending on `@elyvel/i18n` being installed. Override a package's
line from your own app with `lang/vendor/<package>/<locale>/<file>.ts` —
your version wins, and anything you don't override still falls through to
the package's default.

## Using translations

```ts
import { __, transChoice } from '@elyvel/i18n'

__('messages.greeting', { name: 'ada' })           // 'Hello Ada' — :Name capitalizes the value
transChoice('messages.apples', 0)                  // 'No apples'
transChoice('messages.apples', 5)                  // '5 apple(s)'
```

`trans` is an alias of `__`. Placeholders: `:name` substitutes as-is,
`:Name` capitalizes, `:NAME` upper-cases. Pluralization (`transChoice`)
picks the right segment for the count using each locale's real plural
rules (via `Intl.PluralRules`) — English's two forms, Russian's
`one`/`few`/`many`/`other`, or Indonesian's single form regardless of
count — plus explicit `{0}`/`[1,19]`/`[20,*]` range segments that take
priority over the CLDR-derived rule.

In a request handler, the same helpers are already available on the
context: `ctx.locale`, `ctx.__`, `ctx.trans`, `ctx.transChoice`.

## Setting the locale

There's **no automatic locale detection** — the framework deliberately
doesn't infer a locale from `Accept-Language` or a query param on its own.
Set it explicitly, typically from a small app-level middleware:

```ts
// app/middleware/SetLocale.ts
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

Register it globally so validation errors and everything else downstream
come back translated too. `setRequestLocale()` is safe to call after an
`await` (e.g. after a session lookup) — it's request-scoped, not tied to a
synchronous call in `onRequest`.

For one-off scoping outside a request (a script, a job), use
`runWithLocale(locale, fn)` instead. `currentLocale()`/`getLocale()` reads
whichever is active; `setLocale(locale)` changes the process-wide default
rather than a per-request override.

## Frontend integration

There's no built-in bridge to Vue/Inertia yet — translations are a
server-side concern only. If your frontend needs translated strings or the
active locale, share them yourself as an Inertia prop (e.g.
`Inertia.share('locale', ctx => ctx.locale)`) rather than expecting a
built-in mechanism.

## Fallback behavior

A key missing in the active locale falls back to the `fallback` locale; a
key missing in both is returned as-is (the key string itself), matching
Laravel's behavior — never a thrown error. Opt into logging every miss with
`logMissing: true` in `config/i18n.ts`.

## Testing

```ts
import { runWithLocale } from '@elyvel/i18n'

const greeting = runWithLocale('id', () => __('messages.greeting', { name: 'Ada' }))
```

`runWithLocale` scopes cleanly around concurrent work — parallel calls (or
parallel requests each calling `setRequestLocale` in their own
`beforeHandle`) don't leak into each other.
