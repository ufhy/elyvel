import { AuthGuard, betterAuthPlugin, VerifiedGuard } from '@elyvel/auth'
import {
  ConvertEmptyStringsToNullMiddleware,
  defineMiddlewareConfig,
  TrimStringsMiddleware,
} from '@elyvel/core'

/**
 * HTTP middleware wiring — the app's central bootstrap (à la Laravel's
 * `bootstrap/app.php`). Registered ONCE here, so route files stay clean.
 *
 * - `global`: trims request strings and converts blank ones to `null` (à la
 *   Laravel's `TrimStrings`/`ConvertEmptyStringsToNull`) before anything else
 *   sees the request. `betterAuthPlugin` mounts `/api/auth/*` and derives
 *   `user` app-wide (read from context in API routes). No Inertia — the SPA
 *   shell is served by routes/web.ts and talks to the JSON API.
 * - `aliases`: per-route guards, used as `{ middleware: 'auth' }` — like
 *   Laravel's route middleware. `auth` requires a user; `verified` also requires
 *   a verified email.
 */
export default defineMiddlewareConfig({
  global: [TrimStringsMiddleware, ConvertEmptyStringsToNullMiddleware, betterAuthPlugin()],
  aliases: {
    auth: AuthGuard,
    verified: VerifiedGuard,
  },
})
