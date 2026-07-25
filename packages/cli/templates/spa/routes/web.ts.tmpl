import { route } from '@elyvel/core'
import { spa } from '@elyvel/vite'

/**
 * Serve the Vue SPA shell (with Vite tags) for every non-API route, so
 * client-side routing / deep links work. The SPA talks to the JSON API:
 * `/api/auth/*` (Better Auth) and `/api/*` (routes/api.ts). No Inertia.
 */

// Applies the saved light/dark preference to <html> before first paint (no flash).
const themeScript = `<script>(function(){try{var a=localStorage.getItem('appearance')||'system';if(a==='dark'||(a==='system'&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}})()</script>`

// The elyvel mark (aperture "e") as an inline SVG favicon — no asset file needed.
const favicon = `<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48' fill='none'><rect width='48' height='48' rx='11' fill='%23FF2D20'/><circle cx='24' cy='24' r='13' fill='none' stroke='%23fff' stroke-width='5' stroke-linecap='round' stroke-dasharray='63 19' transform='rotate(28 24 24)'/><rect x='15' y='21.5' width='18' height='5' rx='2.5' fill='%23fff'/></svg>" />`

export default route().use(
  spa({ entry: 'frontend/app.ts', title: 'Elyvel SPA', head: favicon + themeScript }),
)
