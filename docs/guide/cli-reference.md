# CLI Reference

Every `elyvel <command>` in one place. Flags follow a simple convention:
`--foo=bar` sets a value, bare `--foo` sets it `true`, and `--no-foo` sets
it `false` (used for opt-outs like `serve --no-vite`).

## Where commands come from

`@elyvel/cli` itself only ships the scaffolding commands (`make:*`, `new`,
`serve`, `key:generate`, `down`/`up`, `config:publish`, `lang:publish`,
`package:discover`) — it doesn't depend on `@elyvel/database`,
`@elyvel/queue`, or `@elyvel/scheduler` at all. Runtime commands like
`queue:work`, `migrate`, and `schedule:run` are contributed by those
packages themselves: any package can export `elyvelCommands` from a
**separate `<pkg>/cli` subpath** (e.g. `@elyvel/queue/cli`, not the
package's main entry), and `elyvel package:discover` finds it and writes
`bootstrap/commands.generated.ts` — the same mechanism already used for
service providers (`elyvelProviders` → `bootstrap/providers.generated.ts`).
Commands live behind that separate subpath specifically so a running app
importing `@elyvel/queue` for `dispatch()`/`Job` never pulls
`queueWorkCommand` and the rest into its own process — only `elyvel`
itself (or the discovery step) ever imports `<pkg>/cli`. This runs
automatically on every `bun install` (wired into the base template's
`postinstall` script), so a package's commands just appear once it's
installed — including a third-party package's own, without ever touching
`@elyvel/cli`'s source.

If a command you expect (e.g. `queue:work`) isn't found, run
`elyvel package:discover` — `elyvel help` also lists whatever it found,
alongside your app's own `app/commands/`, under "App + package commands".

## Application & scaffolding

| Command | Description | Flags |
| --- | --- | --- |
| `elyvel new <name>` | Scaffold a new app | `--kit=vue\|spa\|none` (default `vue`) — writes `.env` with a fresh `APP_KEY` |
| `elyvel serve` | Start the dev server | `--entry=<path>` (auto-detects `server.ts`), `--no-watch`, `--no-vite` (Vite auto-spawns if a `vite.config.*` exists) |
| `elyvel tinker` | REPL with the app booted | — |
| `elyvel key:generate` | Set `APP_KEY` in `.env` | `--show` (print only, don't write), `--force` (allow overwrite in production) |
| `elyvel down` | Enable maintenance mode (503) | `--secret[=value]` (bare form generates and prints one, used to bypass via `?secret=`), `--retry=<seconds>`, `--message=<text>`, `--status=<code>` |
| `elyvel up` | Disable maintenance mode | none |
| `elyvel config:publish [name...]` | Copy default config files into `config/` | zero or more of `app database i18n openapi session logging cache mail queue filesystems broadcasting telegram` (default: all); `--force` |
| `elyvel lang:publish [locale]` | Publish default translation files | `[locale]` (default `en`); `--force`; `--package=<name>` copies an installed package's own `lang/` into `lang/vendor/<name>` instead |
| `elyvel package:discover` | Auto-register installed `@elyvel/*` packages' providers and commands | none — scans `node_modules/@elyvel/*` for `elyvelProviders`/`elyvelCommands`, writes `bootstrap/providers.generated.ts` + `bootstrap/commands.generated.ts`; respects `dontDiscover` in `config/app.ts` |
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
| `make:command <Name>` | Custom `elyvel` command (see [Custom commands](#custom-commands-app-commands) below) | — |
| `auth:generate-migration-plugin` | Migration re-running Better Auth schema sync (after manually enabling a plugin in `config/auth.ts`) | none — no name/flags, always writes `<timestamp>_sync_auth_schema.ts` |

## Custom commands (`app/commands/`)

`elyvel make:command SendReminders` scaffolds `app/commands/SendReminders.ts`,
default-exporting a `ConsoleCommand` (the same shape a package's own
`elyvelCommands` use) — no registration step needed. Every `.ts`/`.js` file
under `app/commands/` is loaded the same way `routes/` is: scanned
recursively, imported, and checked for a conforming default export. A file
that doesn't default-export a `ConsoleCommand` is skipped with a warning
rather than crashing the CLI — so a stray helper file in that directory is
harmless.

```ts
// app/commands/SendReminders.ts
import type { ConsoleCommand } from '@elyvel/core'
import { info } from '@elyvel/cli'

const SendReminders: ConsoleCommand = {
  name: 'send-reminders',
  description: 'Email everyone with an upcoming renewal',
  run: async (flags, args) => {
    info('Reminders sent.')
    return 0
  },
}

export default SendReminders
```

Run it with `elyvel send-reminders`. If the name collides with a
package-contributed command, the app's own command wins — it's more
specific than a package default. Use the same console I/O helpers a
package's own commands use, all imported from `@elyvel/cli`:
`info`/`warn`/`error`/`comment`/`table`/`ask`/`confirm`/`choice`/`secret`/`progressBar`.

## Database (from `@elyvel/database`)

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

## Queue (from `@elyvel/queue`)

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

## Scheduler (from `@elyvel/scheduler`)

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

## Tinker

`elyvel tinker` opens a REPL with the application booted — Laravel's
`artisan tinker`. Config is loaded, providers have run, the database is
connected, and the session is pre-seeded with:

- `app` and a `config()` helper
- every export of every file in `app/models/`, plus `AuthUser`/`AuthAccount`
- the everyday helpers, when their package is installed: `Str`, `Arr`,
  `Collection`, `Crypt`, `Context`, `dispatch`, `Mail`, `notify`, `Gate`,
  `Hash`, `Pipeline`, `Process`, `Concurrency`

```
> await AuthUser.query().count()
3
> const user = await AuthUser.find(1)
> user.email
"ada@example.com"
> Crypt.encryptString('rahasia')
"kD1…"
```

`await` works on any line, variables persist between lines (including
destructured `const { X } = await import(…)`), an unfinished block switches to a
`...` continuation prompt, and `_` holds the last result. `.vars` lists what is
defined; `.exit` (or Ctrl+D) leaves. An error in a line is printed and the
session continues — a typo never costs you your variables.
