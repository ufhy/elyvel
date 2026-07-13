import { route } from '@elysia-ravel/core'

/**
 * Serve the Vite build output at `/build/*` (in production you'd let a CDN or
 * reverse proxy handle this). During `vite` dev, assets come from the dev
 * server instead, so this is only hit for built assets.
 */
export default route().get('/build/*', ({ params }) => {
  const path = (params as Record<string, string>)['*']
  return Bun.file(`public/build/${path}`)
})
