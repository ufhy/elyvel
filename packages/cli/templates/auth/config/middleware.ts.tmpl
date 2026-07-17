import { AuthGuard, betterAuthPlugin, VerifiedGuard } from '@elysia-ravel/auth'
import { defineMiddlewareConfig } from '@elysia-ravel/core'
import { inertia } from '@elysia-ravel/inertia'

/**
 * HTTP middleware wiring — the app's central bootstrap (à la Laravel's
 * `bootstrap/app.php`). Registered ONCE here, so route files stay clean: no
 * per-file `.use(...)`.
 *
 * - `global`: applied to every request. `betterAuthPlugin` mounts `/api/auth/*`
 *   and derives `user` app-wide; `inertia` transforms every Inertia response.
 * - `aliases`: per-route guards, used as `{ middleware: 'auth' }` — like
 *   Laravel's route middleware. `auth` requires a user; `verified` also requires
 *   a verified email. Both read the globally-derived `user`.
 */

// Applies the saved light/dark preference to <html> before first paint (no flash).
const themeScript = `<script>(function(){try{var a=localStorage.getItem('appearance')||'system';if(a==='dark'||(a==='system'&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}})()</script>`

export default defineMiddlewareConfig({
  global: [
    betterAuthPlugin(),
    inertia({
      vite: { entry: 'resources/js/app.ts' },
      ssr: { bundle: 'public/build/ssr/ssr.js' },
      head: themeScript,
    }),
  ],
  aliases: {
    auth: AuthGuard,
    verified: VerifiedGuard,
  },
})
