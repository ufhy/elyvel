# Configuration

All of an elyvel app's configuration lives in the `config/` directory — one file
per concern, each a typed TypeScript module. Because config is plain code, your
editor autocompletes every option and a typo fails the type-check.

## The app config

`config/app.ts` is the entry point. `defineAppConfig` pins its type:

```ts
// config/app.ts
import { defineAppConfig } from '@elyvel/core'
import { EloquentServiceProvider } from '@elyvel/database'
import { I18nServiceProvider } from '@elyvel/i18n'
import { AppServiceProvider } from '../app/providers/AppServiceProvider'

export default defineAppConfig({
  name: process.env.APP_NAME ?? 'my-app',
  env: process.env.APP_ENV ?? 'local',
  key: process.env.APP_KEY, // signs cookies; powers `encrypted` casts
  port: Number(process.env.PORT ?? 3000),

  // Show the detailed debug page for uncaught 500s outside production
  // (default true there already; always off in production regardless).
  debug: process.env.APP_ENV !== 'production',
  // Timezone for date *display* — storage always stays UTC. Default `UTC`.
  timezone: 'Asia/Makassar',

  // Service providers booted at startup.
  providers: [EloquentServiceProvider, I18nServiceProvider, AppServiceProvider],
})
```

## Environment

Environment-specific values live in `.env` and are read via `process.env`:

```ini
APP_NAME="My App"
APP_ENV=local
APP_KEY=            # set with: bun run key:generate
PORT=3000
DB_CONNECTION=sqlite
```

::: warning APP_KEY is required
`APP_KEY` signs session cookies and encrypts `encrypted` model casts. The app
won't boot without it — run `bun run key:generate` after installing.
:::

## Reading config at runtime

Use the global `config()` helper (Laravel's `config()`) anywhere after boot —
dot-path with an optional fallback:

```ts
import { config } from '@elyvel/core'

config<string>('app.env')                 // 'local'
config<string>('auth.loginPath', '/login') // fallback when unset
```

## Available config files

Each starter includes the files it needs; the rest are available to add as you
adopt a package.

| File | Configures |
| --- | --- |
| `app.ts` | Name, environment, debug page, timezone, key, port, providers |
| `database.ts` | Database connections (Eloquent) |
| `session.ts` | Cookie/session driver |
| `logging.ts` | Log channels & formatting |
| `i18n.ts` | Locale, fallback, translation path |
| `openapi.ts` | OpenAPI / API docs generation |
| `cache.ts` | Cache stores |
| `queue.ts` | Queue connections & workers |
| `mail.ts` | Mailer transports |
| `filesystems.ts` | Storage disks (local / S3) |
| `broadcasting.ts` | WebSocket broadcasting |
| `auth.ts` | Authentication — see [Authentication](/security/authentication) |
| `middleware.ts` | Global middleware, aliases, and groups |

`auth.ts`, `middleware.ts`, and `mail.ts` ship with the `vue`/`spa` starter kits
(which wire up Better Auth and its emails); a backend-only app adds them by
hand when it needs them.

## Service providers

The `providers` array in `config/app.ts` lists the providers to boot. Each
provider's `register()` binds services into the container; its `boot()` runs
startup logic once everything is registered.

### Package auto-discovery

You don't have to register a package's provider by hand. On `bun install` the
`postinstall` hook runs `elyvel package:discover`, which scans installed
`@elyvel/*` packages and writes `bootstrap/providers.generated.ts`. The framework
merges those with your configured `providers` at boot — so adding a package is
usually just installing it. Opt a package out with `dontDiscover` in
`config/app.ts` if you need to register it manually.
