# MCP

`@elyvel/mcp` is AI-assisted development for elyvel apps — the
[Laravel Boost](https://github.com/laravel/boost) idea: give a coding agent
(Claude Code, Cursor, anything that speaks MCP) the context it needs to write
correct code for **this** application instead of guessing. It has two halves:

- an **MCP server** whose tools read the live application — real schema, real
  routes, real logs, real package versions;
- **composed guidelines** written into `AGENTS.md` — elyvel conventions,
  scoped to the packages the app actually has installed.

## Installation

`@elyvel/mcp` is dev tooling, exactly like `@elyvel/cli`: install it as a **dev**
dependency, and nothing of it ever ships to production — it exports no service
provider, and its commands live behind the CLI-only `/cli` subpath.

```sh
bun add -d @elyvel/mcp
bun elyvel mcp:install
```

`mcp:install` does two idempotent things:

1. **`AGENTS.md`** — writes the composed guidelines between
   `<!-- elyvel-mcp:guidelines:start/end -->` markers. Your own content in
   the file is never touched; re-running refreshes only the managed block.
   Sections are selected by what's installed — an app without `@elyvel/queue`
   gets no queue guidance — and stamped with the exact installed versions.
2. **`.mcp.json`** — registers the `elyvel-mcp` server (the standard file
   Claude Code, Cursor, and friends read), merging with any servers already
   listed.

Re-run it after adding or removing `@elyvel/*` packages so the guidelines
follow. If it ends up in `dependencies` instead of `devDependencies`, the
installer warns you.

## The MCP tools

The server boots your application once and answers from it — an agent using
these tools is reading your app, not its assumptions.

| Tool | What it answers |
| --- | --- |
| `application-info` | Name/env, Bun version, every installed `@elyvel` package with its exact version, the database connection, the models. |
| `database-schema` | Real tables and columns from the live connection — before writing a migration, model, or query. |
| `database-query` | One **read-only** SQL statement (`SELECT`/`WITH`/`EXPLAIN`/`SHOW`/`DESCRIBE`/`PRAGMA`), rows back as JSON. Writes are rejected. |
| `database-connections` | The connections in `config/database.ts` and which is default. |
| `list-routes` | Every registered HTTP route, with middleware/authorize metadata where recorded. |
| `read-log-entries` | Newest application log entries, filterable by level or search string. |
| `last-error` | The most recent error-level entry with its full context (stack trace, request id) — the first thing to check when something broke. |
| `tinker` | Run TypeScript in the booted app, exactly [`elyvel tinker`](/guide/cli-reference#tinker)'s evaluator: models and `config()` in scope, `await` works, variables persist between calls. |
| `get-absolute-url` | A path resolved against the app's base URL (`app.url`, or `http://localhost:<port>`). |

`mcp:serve` starts the server over stdio; you never run it by hand — the MCP
client spawns it from `.mcp.json`. Over stdio, stdout belongs to the protocol,
so it redirects all application logging to stderr before booting.

## `app.url`

Absolute URLs built outside a request (here, and anywhere else that needs
one) come from the `url` key in `config/app.ts` — the scaffolded config reads
`APP_URL`. Unset, it falls back to `http://localhost:<port>`.

## Scope

This package deliberately does not (yet) include Laravel Boost's hosted
documentation search, browser log capture, or the skills/rules system. The
guidelines block plus the live-application tools are the load-bearing parts.
