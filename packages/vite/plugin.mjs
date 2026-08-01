// Plain JavaScript on purpose. Vite loads `vite.config.ts` under **Node**, not
// Bun, and every other file this package ships is raw TypeScript — importing one
// from a vite config kills the whole build with ERR_UNKNOWN_FILE_EXTENSION. This
// is the one file a Node process has to read, so it must not need a compiler.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * The file the dev server writes while it runs. Its presence is what tells the
 * backend to emit dev tags instead of built assets; its contents are the URL
 * those tags are built from. Same path as Laravel's Vite integration.
 *
 * Kept in step with `DEFAULT_HOT_FILE` in `src/tags.ts` — the two are asserted
 * equal in `test/plugin.test.ts`, because a mismatch would mean the dev server
 * writes a file the backend never looks at, and dev silently serves stale builds.
 */
export const DEFAULT_HOT_FILE = 'public/hot'

/**
 * Tells the elyvel server that a Vite dev server is running, by writing the hot
 * file — and deleting it when the process goes away.
 *
 * Why a file rather than an environment variable: the backend needs to know
 * whether a dev server is running *right now*, and only the dev server knows
 * that. Deriving it from `APP_ENV` answered a different question, and got it
 * wrong in both directions — a stale `public/build/` served after switching back
 * to dev, and, far worse, a production deploy with `APP_ENV` unset emitting
 * `http://localhost:5173/...` asset URLs to real visitors: the page renders,
 * every asset 404s in the browser, and the server logs nothing at all.
 *
 * The file holds the dev server URL **including Vite's `base`**, exactly as
 * Laravel writes it, so the backend appends only the asset path.
 *
 * @param {{ hotFile?: string }} [config]
 * @returns {{ name: string, configureServer: (server: any) => void }} the vite plugin
 */
export function elyvel(config = {}) {
  const hotFile = config.hotFile ?? DEFAULT_HOT_FILE

  const clean = () => {
    if (existsSync(hotFile))
      rmSync(hotFile)
  }

  return {
    name: 'elyvel',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const address = server.httpServer?.address()
        if (!address || typeof address === 'string')
          return

        const dir = dirname(hotFile)
        if (dir && dir !== '.' && !existsSync(dir))
          mkdirSync(dir, { recursive: true })

        const base = (server.config.base ?? '/').replace(/\/$/, '')
        writeFileSync(hotFile, `${resolveDevServerUrl(address, server.config)}${base}`)
      })

      // `exit` covers a clean shutdown; the signal handlers exist because a
      // signal terminates the process WITHOUT firing `exit`, which would leave a
      // stale hot file behind — and a stale hot file is the failure this plugin
      // exists to prevent, pointing the backend at a dev server that is gone.
      process.on('exit', clean)
      process.on('SIGINT', () => process.exit())
      process.on('SIGTERM', () => process.exit())
      process.on('SIGHUP', () => process.exit())
    },
  }
}

/**
 * Mirrors laravel-vite-plugin's `resolveDevServerUrl`, including the detail that
 * cost a real debugging session here: an IPv6 address must be bracketed. Vite
 * binds `::1` by default on this machine, and writing it bare produced
 * `http://::1:5199/build` — an invalid URL the browser silently refuses, with the
 * page rendering and every asset missing.
 *
 * @param {{ address: string, port: number, family?: string | number }} address
 * @param {any} config resolved vite config
 * @returns {string} the dev server origin, e.g. `http://[::1]:5173`
 */
function resolveDevServerUrl(address, config) {
  if (config.server?.origin)
    return config.server.origin

  const hmr = typeof config.server?.hmr === 'object' ? config.server.hmr : null
  const clientProtocol = hmr?.protocol ? (hmr.protocol === 'wss' ? 'https' : 'http') : null
  const protocol = clientProtocol ?? (config.server?.https ? 'https' : 'http')

  const isIpv6 = address.family === 'IPv6' || address.family === 6
  const configHost = typeof config.server?.host === 'string' ? config.server.host : null
  const host = hmr?.host ?? configHost ?? (isIpv6 ? `[${address.address}]` : address.address)

  return `${protocol}://${host}:${hmr?.clientPort ?? address.port}`
}
