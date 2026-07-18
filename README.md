<p align="center">
  <img src="art/logo.svg" width="84" height="84" alt="elyvel" />
</p>

<h1 align="center">elyvel</h1>

<p align="center">A Laravel-inspired, <strong>Elysia-first</strong> application framework for <a href="https://bun.sh">Bun</a>.</p>

---

It borrows Laravel's conventions — folder structure, service providers, config,
an Artisan-style generator, Eloquent-style models — while keeping
[Elysia](https://elysiajs.com)'s end-to-end type-safety. No facades, no runtime
magic, no lost types.

> **Status:** pre-1.0. The framework is broad and heavily tested, but the API may
> still change between minor versions (see [CONTRIBUTING.md](CONTRIBUTING.md)).

## Packages

**Foundation**

| Package | Description |
| --- | --- |
| [`@elyvel/core`](packages/core) | Kernel: `Application`, `ServiceProvider`, typed `Container`, config + env, logger, router, sessions, CORS, throttle, dates (dayjs), maintenance mode, OpenAPI |
| [`@elyvel/support`](packages/support) | Foundational utilities — `Collection`, `LazyCollection`, the message-translation seam |
| [`@elyvel/cli`](packages/cli) | The `elyvel` command — dev server, generators, migrate/seed, queue/schedule workers, `lang:publish` |

**Data**

| Package | Description |
| --- | --- |
| [`@elyvel/database`](packages/database) | Eloquent-style Active Record ORM (SQLite · Postgres · PGlite · MySQL): models, relations, migrations, seeders, factories, tz-aware queries |
| [`@elyvel/validation`](packages/validation) | Rule DSL, message bag, `FormRequest` |

**HTTP & frontend**

| Package | Description |
| --- | --- |
| [`@elyvel/auth`](packages/auth) | Better Auth (Eloquent adapter), authorization gate + policies, hashing |
| [`@elyvel/inertia`](packages/inertia) | Inertia.js server adapter — full-stack SPA (Vue/React/Svelte), SSR |
| [`@elyvel/vite`](packages/vite) | Vite asset tags + serve a Vite SPA (no Inertia required) |
| [`@elyvel/view`](packages/view) | Server-side HTML views — safe `html` template tag + `view()` responses |
| [`@elyvel/i18n`](packages/i18n) | Localization — translations, `:placeholder`s, CLDR pluralization, per-request locale |

**Messaging**

| Package | Description |
| --- | --- |
| [`@elyvel/mail`](packages/mail) | Mailables + transports (log/array/smtp) |
| [`@elyvel/notifications`](packages/notifications) | Multi-channel notifications (mail/database/telegram/broadcast) |
| [`@elyvel/broadcasting`](packages/broadcasting) | Bun-native WebSocket pub/sub |
| [`@elyvel/telegram`](packages/telegram) | Telegram Bot API client + notification channel |

**Ops**

| Package | Description |
| --- | --- |
| [`@elyvel/queue`](packages/queue) | Jobs + workers (sync/memory/database/redis) |
| [`@elyvel/events`](packages/events) | Event dispatcher + listeners |
| [`@elyvel/scheduler`](packages/scheduler) | Cron scheduling, fluent frequencies, `schedule:run` |
| [`@elyvel/cache`](packages/cache) | Cache repository (memory + file stores) |
| [`@elyvel/storage`](packages/storage) | File storage — local + S3 (Bun-native) disks |
| [`@elyvel/testing`](packages/testing) | HTTP test client, response assertions, `refreshDatabase` |

Runnable references: [`examples/fullstack-vue`](examples/fullstack-vue) (Inertia + Vue) ·
[`examples/spa-vue`](examples/spa-vue) (Vite SPA, no Inertia).

## Quick start

```bash
# scaffold a new app
elyvel new myapp --kit=vue      # or --kit=spa
cd myapp && bun install
elyvel serve                    # → http://localhost:3000

# …or run a bundled example from this repo
bun install
cd examples/fullstack-vue && bun run server.ts
```

## Concepts

| Laravel | elyvel |
| --- | --- |
| Service Provider | `ServiceProvider` (register → boot lifecycle) |
| Container / Facade | Typed `Container` + `token<T>()`, resolved explicitly |
| Config + `.env` | `config/*.ts` files + typed `defineEnv()`, global `config()` / `app()` |
| Routing + Controller | Elysia plugins auto-loaded from `routes/`; `route()` groups + middleware aliases |
| Eloquent | `class Post extends Model` — dirty tracking, casts, relations, scopes; same model on all four drivers |
| Carbon | date columns cast to a **dayjs** object — `created_at.format('DD/MM/YYYY')`, `.tz(…)`, `.diff(…)` |
| Migrations / Seeders | `up`/`down` files + `Seeder` classes, tracked in `_elyvel_migrations` |
| Fortify / Sanctum | Better Auth via `betterAuthPlugin()` — `{ auth: true }` / `{ verified: true }` macros, typed `user` in context |
| Gate / Policies | `Gate` abilities + class-based policies (`make:policy`) |
| Validation / Form Request | rule DSL + `FormRequest`, translatable messages |
| Localization | `__('group.key')` / `trans_choice`, `lang/<locale>/…`, `elyvel lang:publish` |
| Artisan | `elyvel serve · new · migrate[:fresh] · db:seed · make:* · queue:work · schedule:run · lang:publish · down`/`up` |
| Maintenance mode | `elyvel down` / `elyvel up` (503 + secret bypass) |
| API docs | OpenAPI/Scalar auto-generated from typed routes at `/openapi` |

## Conventions

```
your-app/
├── app/
│   ├── controllers/     # Elysia plugins
│   ├── middleware/
│   ├── models/          # class X extends Model
│   ├── policies/        # authorization policies
│   └── providers/       # ServiceProviders
├── config/              # *.ts files, one namespace each (app, database, i18n, …)
├── database/
│   ├── migrations/      # up/down files, run in filename order
│   └── seeders/         # DatabaseSeeder is the entrypoint
├── lang/                # <locale>/<group>.ts translation files
├── routes/              # auto-mounted Elysia instances
├── .env
└── server.ts            # createApp().listen()
```

## Development

```bash
bun test          # full suite (bun:test); set TEST_DIALECTS / *_URL in .env for pg/mysql
bun run typecheck
bun run lint
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the versioning policy and
[SECURITY.md](SECURITY.md) for the security posture and hardening checklist.

## License

MIT.
