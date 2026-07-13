import { route } from '@elysia-ravel/core'
import { spa } from '@elysia-ravel/vite'

/**
 * Mode B: a plain Vite + Vue SPA (no Inertia) served single-origin under
 * `/dashboard`. `spa()` returns the shell for every route beneath it so
 * client-side routing works; the SPA calls the JSON API on `/api`.
 * `assets: false` because routes/assets.ts already serves `/build`.
 */
export default route().use(
  spa({ entry: 'resources/js/spa.ts', prefix: '/dashboard', title: 'Dashboard', assets: false }),
)
