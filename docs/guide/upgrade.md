# Upgrade Guide

## Upgrading to 0.1.0-alpha.4 from alpha.3

One theme runs through every change below: **the framework stopped inferring
behaviour from `APP_ENV`**. A variable named after the environment was silently
deciding a log file's format, whether a session cookie was Secure, whether stack
traces were rendered, whether your API surface was published, and whether asset
tags pointed at a dev server. Each of those is now read from the config file that
the setting belongs to. Where an app wants the environment to decide, it says so
in its own config, on a line you can see and delete — the same split Laravel uses.

Every item was checked against Laravel's source before changing.

### Vite: a dev server is detected by its hot file

**Impact: high, for apps using `@elyvel/vite` or `@elyvel/inertia`.**

Add the plugin to `vite.config.ts`:

```ts
import { elyvel } from '@elyvel/vite/plugin'

export default defineConfig({
  plugins: [elyvel(), /* ... */],
})
```

It writes `public/hot` while the dev server runs and deletes it on exit; the
backend emits dev tags for exactly as long as that file exists. Add `public/hot`
to `.gitignore`.

Two consequences:

- With **no dev server and no build manifest**, rendering now throws instead of
  emitting `http://localhost:5173/...` URLs. That fallback was how a production
  deploy with `APP_ENV` unset served asset URLs pointing at a machine that
  wasn't there — page renders, every asset 404s, server logs nothing.
- Tests that render pages without running `vite build` should call
  `withoutVite()` (Laravel's helper of the same name):

  ```ts
  import { withoutVite } from '@elyvel/vite'

  withoutVite()
  ```

### Session cookies are not Secure unless you say so

**Impact: high if you deploy over HTTPS and relied on the old default.**

`secure` previously defaulted to `app.env === 'production'`. It now defaults to
false and comes from config alone. Add to `config/session.ts`:

```ts
secure: process.env.SESSION_SECURE_COOKIE === 'true',
```

and set `SESSION_SECURE_COOKIE=true` wherever you serve HTTPS. The old default
also failed the other way: an app labelled production but reached over plain http
set a Secure cookie the browser refused to send back, so every session read empty
with nothing logged.

### `app.debug` defaults to off and is obeyed everywhere

**Impact: low, and in the safe direction.**

It used to default to on and be force-disabled in production. Now it defaults to
**false** and is honoured in every environment. To keep detailed error pages
locally, add to `config/app.ts`:

```ts
debug: process.env.APP_DEBUG === 'true',
```

and `APP_DEBUG=true` to your local `.env`. Never on a public host: it is no
longer overridden for you.

### OpenAPI exposure is a config decision

**Impact: medium — docs now default to ON.**

`enabled` no longer defaults to `app.env !== 'production'`. Installing the
optional `@elysiajs/openapi` peer is the opt-in. To keep docs off in production,
put it in `config/openapi.ts` where it is visible:

```ts
enabled: process.env.OPENAPI_ENABLED
  ? process.env.OPENAPI_ENABLED === 'true'
  : process.env.APP_ENV !== 'production',
```

### Log files are JSON; the console is human-readable

**Impact: medium if you parse your own log files.**

Format no longer follows `APP_ENV`. Files are JSON in every environment, the
console is readable, and `pretty` overrides both. A file outlives the environment
that wrote it, and a file holding two formats is one a reader gets wrong — the
log viewer read 18 of one such file's 64 entries. Set `pretty: true` in
`config/logging.ts` to get the old text format back.

### Log levels: all eight of RFC 5424

**Impact: none for existing code.**

`notice`, `warning`, `critical`, `alert` and `emergency` join `debug`, `info` and
`error`. `warn()` still works and is recorded as `warning`, so files and filters
see one name for one level. Anything at `warning` or above now goes to stderr.

### Channels, `LOG_CHANNEL`, and the `null` driver

**Impact: none unless you adopt them.**

`config/logging.ts` can take the named-channel shape (`stack`, `console`,
`single`, `daily`, `null`) with `default: process.env.LOG_CHANNEL ?? 'stack'`.
`LOG_CHANNEL=null` then silences logging without deleting the configuration that
records where logs would otherwise go. `app.log.build({...})` and
`app.log.stack([...])` create loggers at the call site.
