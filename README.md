# elysia-ravel

A Laravel-inspired, **Elysia-first** application framework for [Bun](https://bun.sh).

It borrows Laravel's conventions — folder structure, service providers, config,
and an Artisan-style generator — while keeping [Elysia](https://elysiajs.com)'s
end-to-end type-safety. No facades, no runtime magic, no lost types.

> **Status:** Phase 3. Foundation + ORM/migrations + auth are done; queues,
> events, and scheduling are planned.

## Packages

| Package | Description |
| --- | --- |
| [`@elysia-ravel/core`](packages/core) | Kernel: `Application`, `ServiceProvider`, typed `Container`, config + env, logger, route auto-loader |
| [`@elysia-ravel/orm`](packages/orm) | Drizzle ORM, multi-driver (SQLite · Postgres · PGlite): `defineModel`, imperative migrations, seeders |
| [`@elysia-ravel/auth`](packages/auth) | Token auth guard, password hashing, and an authorization gate |
| [`@elysia-ravel/cli`](packages/cli) | The `ravel` command — dev server + generators + migrate/seed |
| [`examples/basic-app`](examples/basic-app) | A minimal, runnable reference app |

## Quick start

```bash
bun install
cd examples/basic-app
bun run server.ts        # or: ravel serve
# → http://localhost:3000/api/health
```

## Concepts

| Laravel | elysia-ravel |
| --- | --- |
| Service Provider | `ServiceProvider` (register → boot lifecycle) |
| Container / Facade | Typed `Container` + `token<T>()`, resolved explicitly |
| Config + `.env` | `config/*.ts` files + typed `defineEnv()` |
| Routing + Controller | Elysia plugins auto-loaded from `routes/` |
| Eloquent | `defineModel(table)` over Drizzle — async, typed `all/find/create/where/query`; same model on SQLite/Postgres |
| DB switching | Change `default` in `config/database.ts` (drivers: `sqlite`/`pg`/`pglite`) — no app code changes |
| Migrations / Seeders | Imperative `up`/`down` files + `Seeder` classes, tracked in `_ravel_migrations` |
| Auth (Sanctum) | `createAuth(...).guard()` Elysia plugin — token guard, `{ auth: true }` macro, typed `user` in context |
| Gate / Policies | `createGate<User>().define(ability, fn)` → `allows` / `authorize` |
| Hashing | `Hash.make` / `Hash.verify` over `Bun.password` (argon2) |
| Logging | Leveled `Logger` with channels/stack, console/file/daily/buffered transports, size & daily rotation, key + pattern redaction, per-request correlation id, and `app.catchExceptions()` |
| Artisan | `ravel serve`, `ravel migrate[:fresh]`, `ravel db:seed`, `ravel make:*` |

## Conventions

```
your-app/
├── app/
│   ├── controllers/     # Elysia plugins
│   ├── middleware/
│   ├── models/          # defineModel(table)
│   ├── policies/        # createGate abilities
│   └── providers/       # ServiceProviders
├── config/              # *.ts files, one namespace each (app, database, …)
├── database/
│   ├── migrations/      # up/down files, run in filename order
│   └── seeders/         # DatabaseSeeder is the entrypoint
├── routes/              # auto-mounted Elysia instances
├── .env
└── server.ts            # createApp().listen()
```

## Development

```bash
bun test        # run the suite (bun:test)
bun run typecheck
bun run lint
```

## License

MIT
