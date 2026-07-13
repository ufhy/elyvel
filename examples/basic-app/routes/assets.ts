import { staticFiles } from '@elysia-ravel/core'

/**
 * Serve the Vite build output at `/build/*` (in production a CDN or reverse
 * proxy usually handles this). During `vite` dev, assets come from the dev
 * server instead, so this is only hit for built assets.
 */
export default staticFiles({ prefix: '/build', dir: 'public/build' })
