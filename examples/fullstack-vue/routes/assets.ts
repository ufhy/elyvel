import { staticFiles } from '@elyvel/core'

/**
 * Serve the Vite build output at `/build/*`. In production a CDN or reverse
 * proxy usually handles this; during `vite` dev, assets come from the dev
 * server, so this is only hit for built assets.
 */
export default staticFiles({ prefix: '/build', dir: 'public/build' })
