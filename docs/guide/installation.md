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

Scaffold a new application with the `elyvel` CLI:

```bash
bunx elyvel new my-app
```

Pick a starter kit with `--kit` (you'll be prompted if you omit it):

| Kit | What you get |
| --- | --- |
| `base` | A backend-only app — config, providers, and a health route. The default. |
| `auth` | `base` plus Better Auth wiring, auth pages, and the auth migrations. |
| `spa` | A Vue single-page-app frontend wired through Vite. |
| `none` | The bare minimum — no starter pages. |

```bash
bunx elyvel new my-app --kit auth
```

## Installing & keying the app

```bash
cd my-app
bun install
bun run key:generate   # writes APP_KEY into .env
```

`APP_KEY` is the secret used to sign session cookies and power `encrypted` model
casts. The app **refuses to boot without it**, so generate it before your first
run. (`bun run key:generate` runs `elyvel key:generate`.)

## Running the dev server

```bash
bun run dev    # elyvel serve
```

Your app boots on `http://localhost:3000`. For the `spa`/`auth` kits this also
starts Vite for frontend HMR. A newly scaffolded app exposes a health route you
can hit right away:

```bash
curl http://localhost:3000/api/health
# { "status": "ok", "app": "my-app" }
```

To run the compiled server directly (e.g. in production), use `bun run start`,
which executes `server.ts`.

## Next steps

- [Directory Structure](/guide/directory-structure) — where everything lives.
- [Configuration](/guide/configuration) — config files, `.env`, and the
  `config()` helper.
- [Authentication](/security/authentication) — if you scaffolded the `auth` kit.
