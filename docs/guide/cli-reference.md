# CLI Reference

Every `elyvel <command>` in one place. Flags follow a simple convention:
`--foo=bar` sets a value, bare `--foo` sets it `true`, and `--no-foo` sets
it `false` (used for opt-outs like `serve --no-vite`).

## Application & scaffolding

| Command | Description | Flags |
| --- | --- | --- |
| `elyvel new <name>` | Scaffold a new app | `--kit=vue\|spa\|none` (default `vue`) — writes `.env` with a fresh `APP_KEY` |
| `elyvel serve` | Start the dev server | `--entry=<path>` (auto-detects `server.ts`), `--no-watch`, `--no-vite` (Vite auto-spawns if a `vite.config.*` exists) |
| `elyvel key:generate` | Set `APP_KEY` in `.env` | `--show` (print only, don't write), `--force` (allow overwrite in production) |
| `elyvel down` | Enable maintenance mode (503) | `--secret[=value]` (bare form generates and prints one, used to bypass via `?secret=`), `--retry=<seconds>`, `--message=<text>`, `--status=<code>` |
| `elyvel up` | Disable maintenance mode | none |
| `elyvel config:publish [name...]` | Copy default config files into `config/` | zero or more of `app database i18n openapi session logging cache mail queue filesystems broadcasting telegram` (default: all); `--force` |
| `elyvel lang:publish [locale]` | Publish default translation files | `[locale]` (default `en`); `--force`; `--package=<name>` copies an installed package's own `lang/` into `lang/vendor/<name>` instead |
| `elyvel package:discover` | Auto-register installed `@elyvel/*` packages' providers | none — scans `node_modules/@elyvel/*` for `elyvelProviders`, writes `bootstrap/providers.generated.ts`; respects `dontDiscover` in `config/app.ts` |
| `elyvel broadcast:serve` | Run the WebSocket/broadcast layer as its own process | `--port=<n>` |

::: tip `down`/`up` aren't in `elyvel help`
Maintenance mode's `down`/`up` commands work but don't appear in the
printed help banner — easy to miss if you're only skimming `elyvel help`.
:::

## Make generators

Every `make:*` generator accepts `--force` to overwrite an existing file.

| Command | Description | Extra flags |
| --- | --- | --- |
| `make:controller <Name>` | Controller | `--resource` (7-action), `--invokable`, `--singleton` (+ `--creatable`), `--model=[Name]` (route-binding hint, infers from name), `--parent=[Name]` (nesting hint), `--requests` (also generates Store/Update FormRequests) |
| `make:model <Name>` | Model | `--migration`, `--factory`, `--seed`, `--controller`, `--all` (all four) |
| `make:migration <name>` | Migration file | table name is guessed from `create_<table>_table`-style names |
| `make:middleware <Name>` | Middleware class | — |
| `make:request <Name>` | Form Request | — |
| `make:policy <Name>` | Authorization policy | `--model=[Model]` (bare flag infers from name, adds the full resource-method set) |
| `make:resource <Name>` | API Resource transform | — |
| `make:event <Name>` | Event class | — |
| `make:listener <Name>` | Event listener | — |
| `make:notification <Name>` | Notification class | — |
| `make:job <Name>` | Queue job | — |
| `make:provider <Name>` | Service provider | — |
| `make:seeder <Name>` | Seeder | — |
| `make:factory <Name>` | Model factory | — |
| `make:concern <Name>` | Model concern (trait-equivalent) | — |
| `auth:generate-migration-plugin` | Migration re-running Better Auth schema sync (after manually enabling a plugin in `config/auth.ts`) | none — no name/flags, always writes `<timestamp>_sync_auth_schema.ts` |

## Database

| Command | Description | Flags |
| --- | --- | --- |
| `elyvel db` | Open the native DB shell (sqlite3/psql) | — |
| `elyvel db:show` | List tables with row counts | — |
| `elyvel db:table <name>` | Describe a table's columns | — |
| `elyvel db:monitor` | Report open connections (Postgres) | `--max=<n>` |
| `elyvel db:seed` | Run `database/seeders/DatabaseSeeder` | — |
| `elyvel migrate` | Run pending migrations | `--step`, `--pretend` |
| `elyvel migrate:fresh` | Drop everything, re-migrate | `--seed` |
| `elyvel migrate:rollback` | Roll back the last batch | `--step=N`, `--batch=N`, `--pretend` |
| `elyvel migrate:reset` | Roll back every migration | — |
| `elyvel migrate:refresh` | Rollback then re-migrate | `--step=N`, `--seed` |
| `elyvel migrate:status` | Show applied/pending migrations | — |
| `elyvel migrate:unlock` | Force-clear a stuck migration lock | — |
| `elyvel model:prune [Name]` | Prune stale prunable records | `[Name]` — all prunable models if omitted |
| `elyvel model:sync <Name>` | Report (or add) `declare` fields missing vs. the actual DB table | `--write` (otherwise dry-run report only) — never touches `fillable`/`guarded`/`casts` |

See [Migrations](/database/migrations) for the schema-builder side of
these commands.

## Queue

See [Queues](/digging-deeper/queues) for the full behavior of each.

| Command | Flags |
| --- | --- |
| `elyvel queue:work` | `--connection=<name>`, `--queue=high,default`, `--once` \| `--stop-when-empty` \| `--max=N`, `--sleep=N`, `--retry-after=N` |
| `elyvel queue:failed` | — |
| `elyvel queue:retry <id>` \| `--all` | — |
| `elyvel queue:forget <id>` | — |
| `elyvel queue:flush` | — |
| `elyvel queue:prune-failed` | `--hours=24` |
| `elyvel queue:restart` | — |

## Scheduler

See [Task Scheduling](/digging-deeper/scheduler) for details.

| Command | Description |
| --- | --- |
| `elyvel schedule:run` | Run everything due right now — the one entry your system cron calls every minute |
| `elyvel schedule:work` | Long-running loop, ticks every second — no system cron needed locally |
| `elyvel schedule:test [name]` | Run a task immediately, ignoring its cron expression |
| `elyvel schedule:list` | Print every task's cron expression, name, and timezone |

## Routes

| Command | Description |
| --- | --- |
| `elyvel route:list` | List every registered route, with Middleware/Authorize columns for `resource()`-registered routes |

See [Routing](/basics/routing#inspecting-routes).
