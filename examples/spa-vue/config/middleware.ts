import { AuthGuard, betterAuthPlugin, VerifiedGuard } from '@elysia-ravel/auth'
import { defineMiddlewareConfig } from '@elysia-ravel/core'

/**
 * HTTP middleware wiring — the app's central bootstrap (à la Laravel's
 * `bootstrap/app.php`). Registered ONCE here, so route files stay clean.
 *
 * - `global`: `betterAuthPlugin` mounts `/api/auth/*` and derives `user`
 *   app-wide (read from context in API routes). No Inertia — the SPA shell is
 *   served by routes/web.ts and talks to the JSON API.
 * - `aliases`: per-route guards, used as `{ middleware: 'auth' }` — like
 *   Laravel's route middleware. `auth` requires a user; `verified` also requires
 *   a verified email.
 */
export default defineMiddlewareConfig({
  global: [betterAuthPlugin()],
  aliases: {
    auth: AuthGuard,
    verified: VerifiedGuard,
  },
})
