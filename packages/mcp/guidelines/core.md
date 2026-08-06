## elyvel core

- The `elyvel` CLI is the artisan equivalent. Discover commands with
  `bun elyvel` (no args prints them all). Generators exist for most things —
  `elyvel make:model`, `make:controller`, `make:migration`, `make:middleware`,
  `make:request`, `make:policy`, `make:job`, `make:event`, `make:listener`,
  `make:seeder`, `make:factory` — always prefer a generator over writing the
  file by hand, then adjust the output.
- Config lives in `config/*.ts`, each file authored with its `define*Config`
  helper so typos fail the type-check. Read values with
  `config('app.name', fallback)` or `app.config.get(...)` — never
  `process.env` outside `config/`.
- Routes live in `routes/*.ts` and are auto-mounted. Middleware groups
  (`web` = session + CSRF, `api`) and aliases come from
  `config/middleware.ts`; session state exists only inside the `web` group.
- Service providers register in `config/app.ts` `providers`; installed
  packages auto-register via `elyvel package:discover` (runs on
  `bun install`). Never edit `bootstrap/*.generated.ts` by hand.
- Errors: uncaught errors are logged with the request's correlation id, then
  rendered honouring `Accept` (JSON for API clients, error pages for
  browsers) and `app.debug` for traces. Look in the log (see the MCP
  tools), not stdout, for what happened.
- Helpers you should reach for before writing your own: `Str`, `Arr`,
  `Collection`, `Pipeline`, `Process`, `Crypt`, `Context` (request-scoped
  values that also flow into queued jobs), and `date()`/`now()` for dates.
