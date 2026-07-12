import { cors, defineMiddlewareConfig } from '@elysia-ravel/core'
import { EnsureJson } from '../app/middleware/EnsureJson'
import { PoweredBy } from '../app/middleware/PoweredBy'

/**
 * HTTP middleware, à la Laravel's Kernel.
 *
 * - `global`  — runs on every request.
 * - `aliases` — named middleware you apply per-route: `{ middleware: 'json' }`.
 *   The built-in `throttle` alias is always available (`{ middleware: 'throttle:60,1' }`).
 * - `groups`  — bundles applied with `.use(group('api'))` in a route file.
 */
export default defineMiddlewareConfig({
  global: [cors(), PoweredBy],
  aliases: {
    json: EnsureJson,
  },
  groups: {
    api: [PoweredBy],
  },
})
