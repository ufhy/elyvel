# Installation

elyvel is a Laravel-inspired, Elysia-first web framework for [Bun](https://bun.sh).
It gives you the ergonomics Laravel developers expect — expressive routing,
middleware, FormRequest validation, an Eloquent-style ORM, queues, events, and a
gate/policy authorization layer — on top of [Elysia](https://elysiajs.com)'s
high-performance, fully type-safe core.

## Requirements

- [Bun](https://bun.sh) `>= 1.1`

That's it — no separate runtime, package manager, or build toolchain to install.

## Creating an application

Scaffold a new application with `bun create`. The default is a full-stack Vue
kit:

```bash
bun create @elyvel my-app
```

Choose a different starter with `--kit` (use the `=` form — `--kit=none`, not
`--kit none`):

| Kit | What you get |
| --- | --- |
| `vue` | **Default.** Full-stack: Better Auth, a Vue + Inertia frontend, auth pages, and the auth migrations. |
| `spa` | Better Auth plus a Vue SPA (Vite + Vue Router, no Inertia). |
| `none` | Backend only — the base template, no frontend or auth. |

```bash
bun create @elyvel my-app --kit=none
```

`bun create @elyvel` also writes a `.env` with a freshly generated **`APP_KEY`**,
so the app is ready to run immediately.

## Running the app

```bash
cd my-app
bun install
bun run migrate   # vue / spa kits — creates the Better Auth tables
bun run dev       # elyvel serve
```

Your app boots on `http://localhost:3000`. The `vue`/`spa` kits also start Vite
for frontend HMR. To run the server directly (e.g. in production), use
`bun run start`, which executes `server.ts`.

::: tip APP_KEY
`APP_KEY` signs session cookies and powers `encrypted` model casts — the app
won't boot without it. `bun create @elyvel` sets it for you; rotate it any time
with `bun run key:generate`.
:::

## The `elyvel` CLI

Inside a project the `elyvel` CLI is available (it ships as a dev dependency).
Run tasks through the `package.json` scripts or invoke it directly:

```bash
bunx elyvel make:model Post   # generate a model
bunx elyvel route:list        # inspect registered routes
bunx elyvel migrate           # run migrations
```

## Next steps

- [Directory Structure](/guide/directory-structure) — where everything lives.
- [Configuration](/guide/configuration) — config files, `.env`, and the
  `config()` helper.
- [Authentication](/security/authentication) — included in the default `vue` kit.
