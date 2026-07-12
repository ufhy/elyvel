import { defineMiddlewareConfig } from '@elysia-ravel/core'
import { EnsureJson } from '../app/middleware/EnsureJson'
import { PoweredBy } from '../app/middleware/PoweredBy'

/**
 * HTTP middleware, à la Laravel's Kernel.
 *
 * - `global`  — runs on every request.
 * - `aliases` — named middleware you apply per-route: `{ middleware: 'json' }`.
 * - `groups`  — bundles applied with `.use(group('api'))` in a route file.
 */
export default defineMiddlewareConfig({
  global: [PoweredBy],
  aliases: {
    json: EnsureJson,
  },
  groups: {
    api: [PoweredBy],
  },
})
