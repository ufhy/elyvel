# OpenAPI Docs

Interactive API documentation generated from your typed routes — no
annotations, no separate spec file to maintain by hand. Elysia already
derives a schema from your route definitions; this just wires the
renderer.

## It's on by default

Outside production, the app automatically mounts a docs UI at `/openapi`
(spec at `/openapi/json`) with no configuration needed at all — nothing to
opt into for local development.

## Configuration

```ts
// config/openapi.ts
import { defineOpenApiConfig } from '@elyvel/core'

export default defineOpenApiConfig({
  enabled: true, // default: on outside production, off in it
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
