import { AuthGuard, betterAuthPlugin, VerifiedGuard } from '@elyvel/auth'
import {
  ConvertEmptyStringsToNullMiddleware,
  defineMiddlewareConfig,
  staticFiles,
  TrimStringsMiddleware,
} from '@elyvel/core'
import { inertia } from '@elyvel/inertia'
import { logViewer } from '@elyvel/log-viewer'
import { SetLocale } from '../app/middleware/SetLocale'

/**
 * HTTP middleware wiring — the app's central bootstrap (à la Laravel's
 * `bootstrap/app.php`). Registered ONCE here, so route files stay clean: no
 * per-file `.use(...)`.
 *
 * - `global`: applied to every request. Trims strings and converts blank ones
 *   to `null` first (à la Laravel's `TrimStrings`/`ConvertEmptyStringsToNull`),
 *   then `betterAuthPlugin` mounts `/api/auth/*` and derives `user` app-wide,
 *   then `inertia` transforms every Inertia response.
 * - `aliases`: per-route guards, used as `{ middleware: 'auth' }` — like
 *   Laravel's route middleware. `auth` requires a user; `verified` also requires
 *   a verified email. Both read the globally-derived `user`.
 */

// Applies the saved light/dark preference to <html> before first paint (no flash).
const themeScript = `<script>(function(){try{var a=localStorage.getItem('appearance')||'system';if(a==='dark'||(a==='system'&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}})()</script>`

// The elyvel mark (aperture "e") as an inline SVG favicon — no asset file needed.
const favicon = `<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48' fill='none'><rect width='48' height='48' rx='11' fill='%23FF2D20'/><circle cx='24' cy='24' r='13' fill='none' stroke='%23fff' stroke-width='5' stroke-linecap='round' stroke-dasharray='63 19' transform='rotate(28 24 24)'/><rect x='15' y='21.5' width='18' height='5' rx='2.5' fill='%23fff'/></svg>" />`

export default defineMiddlewareConfig({
  global: [
    TrimStringsMiddleware,
    ConvertEmptyStringsToNullMiddleware,
    // Sets the request locale from `?lang=` / Accept-Language before anything
    // renders — so validation errors etc. come back in the chosen language.
    SetLocale,
    betterAuthPlugin(),
    inertia({
      vite: { entry: 'resources/js/app.ts' },
      ssr: { bundle: 'public/build/ssr/ssr.js' },
      head: favicon + themeScript,
    }),
    // Gated in AppServiceProvider via configureLogViewer — no environment
    // check here, the app owns who's allowed in (see its own doc comment).
    logViewer(),
    // Serves uploaded post cover images (config/filesystems.ts's `local` disk,
    // `url: '/storage'`) — see PostController's cover_image upload handling.
    staticFiles({ prefix: '/storage', dir: 'storage/app' }),
  ],
  aliases: {
    auth: AuthGuard,
    verified: VerifiedGuard,
  },
})
