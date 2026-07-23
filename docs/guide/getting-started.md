# Introduction

elyvel is a Laravel-inspired, Elysia-first web framework for [Bun](https://bun.sh).
It gives you the ergonomics Laravel developers expect — expressive routing,
middleware, FormRequest validation, an Eloquent-style ORM, queues, events, and a
gate/policy authorization layer — on top of [Elysia](https://elysiajs.com)'s
high-performance, fully type-safe core.

::: warning Work in progress
These docs are being written area by area. The [Authentication](/security/authentication)
chapter is the first complete one; more are on the way.
:::

## Requirements

- [Bun](https://bun.sh) `>= 1.1`

## Creating a project

Scaffold a new application with the `elyvel` CLI:

```bash
bunx elyvel new my-app
cd my-app
bun install
```

## Running the dev server

```bash
bun run dev      # elyvel serve — HTTP server + Vite dev server (HMR)
```

Your app boots on `http://localhost:3000`.

## Project layout

An elyvel app follows a Laravel-like layout so things are where you expect:

```
app/
  providers/       Service providers (register + boot app services)
  requests/        FormRequest validation classes
  models/          Eloquent-style models
  policies/        Authorization policies
config/            Config files (app.ts, auth.ts, middleware.ts, …)
routes/            Route files (web.ts, auth.ts, …)
resources/         Frontend assets (when using Inertia/Vite)
```

## The CLI

The `elyvel` binary bundles the common workflow commands:

```bash
elyvel serve            # run the app (HTTP + Vite)
elyvel make …           # generate models, controllers, requests, policies, …
elyvel migrate          # run database migrations
elyvel route:list       # inspect registered routes
elyvel queue:work       # process queued jobs
```

## Next steps

- [Authentication](/security/authentication) — registration, login, password
  resets, and how to customize every flow.
