# OpenAPI Docs

Interactive API documentation generated from your typed routes — no
annotations, no separate spec file to maintain by hand. Elysia already
derives a schema from your route definitions; this just wires the
renderer.

## It's on by default

Install the optional `@elysiajs/openapi` peer and the app mounts a docs UI at
`/openapi` (spec at `/openapi/json`) with no further configuration — installing
it is the opt-in.

Whether it stays exposed is decided in `config/openapi.ts` and nowhere else. The
framework does not switch it off for you based on `APP_ENV`, the same way
Laravel's Telescope reads only `config('telescope.enabled')`. The scaffolded
config keeps it off in production, on a line you can read and change:

```ts
enabled: process.env.OPENAPI_ENABLED
  ? process.env.OPENAPI_ENABLED === 'true'
  : process.env.APP_ENV !== 'production',
```

Left to a hidden environment check, `config/openapi.ts` said nothing about
whether your API surface was published — which is the one question that file
should answer.

## Configuration

```ts
// config/openapi.ts
import { defineOpenApiConfig } from '@elyvel/core'

export default defineOpenApiConfig({
  enabled: true, // default: on — this file is what decides
  path: '/openapi', // spec served at `${path}/json`
  provider: 'scalar', // or 'swagger-ui'
  title: 'My API',
  version: '1.0.0',
  description: 'Public API for the mobile app.',
})
```

`title`/`version` default to `config('app.name')`/`config('app.version')`
if omitted.

## Optional peer dependency

The docs UI comes from `@elysiajs/openapi`, installed separately:

```bash
bun add @elysiajs/openapi
```

If it isn't installed, the docs route is silently skipped — the rest of
the app boots normally either way, so there's no hard dependency to worry
about in environments that don't need it (e.g. a pure worker process).
