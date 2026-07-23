# Directory Structure

A scaffolded elyvel app follows a Laravel-like layout, so things are where you'd
expect them. Here is the `base` kit; the `auth` and `spa` kits add `database/`
and `resources/` on top.

```
my-app/
├── app/
│   └── providers/
│       └── AppServiceProvider.ts
├── config/
│   ├── app.ts
│   ├── database.ts
│   ├── i18n.ts
│   ├── logging.ts
│   ├── openapi.ts
│   └── session.ts
├── routes/
│   └── web.ts
├── server.ts
├── .env
├── package.json
└── tsconfig.json
```

## The `app` directory

Your application code. It starts with just `providers/`, and grows the familiar
Laravel folders as you generate them (`elyvel make …`):

- **`providers/`** — service providers. `AppServiceProvider` is the place to
  register container bindings (`register()`) and run startup logic (`boot()`) —
  policies, observers, password policy, event listeners, and so on.
- **`models/`** — Eloquent-style models.
- **`controllers/`** — route controllers.
- **`requests/`** — FormRequest validation classes.
- **`policies/`** — authorization policies (registered with the gate).

Only the folders you use need to exist; the framework doesn't require an empty
directory for every concept.

## The `config` directory

One file per concern, each returning a typed config object (see
[Configuration](/guide/configuration)). `config/app.ts` is the entry point — it
declares the app name, environment, and the **service providers** to boot.

## The `routes` directory

Every file under `routes/` is **auto-mounted at boot** — no manual registration.
`routes/web.ts` is the default. Return a value and it's serialized to JSON;
return `view(...)` / `Inertia.render(...)` for HTML. Cookie-based (browser)
routes should run through the built-in `web` group for CSRF protection; API/token
routes stay out of it.

## `server.ts`

The entry point. It bootstraps the framework — load `config/`, register the
providers, and auto-mount `routes/`:

```ts
import { createApp } from '@elyvel/core'

const app = await createApp({ basePath: import.meta.dir })
app.catchExceptions()
await app.listen()
```

## `.env`

Environment variables — `APP_NAME`, `APP_ENV`, `APP_KEY`, `PORT`,
`DB_CONNECTION`, and any credentials. See [Configuration](/guide/configuration).

## The `database` directory <Badge type="tip" text="auth / spa kits" />

Migrations live in `database/migrations/`. Run them with `bun run migrate`
(`elyvel migrate`) or reset with `bun run migrate:fresh`.

## The `resources` directory <Badge type="tip" text="auth / spa kits" />

Frontend assets — `resources/js` (Vue components/pages) and `resources/css` —
compiled by Vite.
