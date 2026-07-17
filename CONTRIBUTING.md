# Contributing to elysia-ravel

Thanks for your interest in improving the framework.

## Development

This is a Bun workspace monorepo. From the repo root:

```bash
bun install
bun test            # run the whole suite (all packages, all DB dialects in .env)
bun run typecheck   # tsc across the monorepo
bun run lint        # eslint (@antfu config)
```

Run the database suite against real servers by pointing `.env` at them
(`POSTGRES_URL`, `MYSQL_URL`) and selecting dialects with `TEST_DIALECTS`
(`sqlite,pglite,pg,mysql`). See `.env.example`.

Every change should keep `bun test`, `bun run typecheck`, and `bun run lint` green,
and land with tests for the behavior it adds or fixes.

## Versioning & stability

elysia-ravel follows [Semantic Versioning](https://semver.org) — with an explicit
pre-1.0 caveat.

### Pre-1.0 (current)

All packages are currently `0.x`. Per SemVer, **anything may change in a `0.x`
release**, including breaking changes in a minor bump. We will still:

- call out breaking changes in the release notes / commit messages, and
- avoid gratuitous churn — breaks happen to fix a real design flaw, not on a whim.

Pin an exact version if you need stability before 1.0.

### 1.0 and after

Once 1.0 ships, releases follow SemVer strictly:

- **MAJOR** — backwards-incompatible API changes.
- **MINOR** — backwards-compatible features.
- **PATCH** — backwards-compatible bug/security fixes.

Breaking changes will land only in MAJOR releases, be documented in an upgrade
guide, and — where practical — be preceded by a deprecation (kept working for at
least one MINOR release with a runtime/type warning).

### What counts as "public API"

The exports of each `@elysia-ravel/*` package entry point, the CLI commands, and
the documented config file shapes. Anything under a package's internal paths, or
marked `@internal`, may change at any time.

## Commit messages

Conventional Commits (`feat:`, `fix:`, `perf:`, `docs:`, `chore:`, `test:`),
scoped by package where it helps (`feat(core): …`).
