import type { ViteOptions } from './tags'
import { configureErrorPage, staticFiles } from '@elyvel/core'
import { trimTrailing } from '@elyvel/support'
import { Elysia } from 'elysia'
import { viteTags } from './tags'

export interface SpaOptions extends ViteOptions {
  /** URL prefix the SPA is mounted at (client-side routes live under it). Default `/`. */
  prefix?: string
  /** Element id the client mounts on. Default `app`. */
  rootId?: string
  /** Directory of built assets to serve at `base`. Default `public/build`. */
  buildDir?: string
  /** `<title>` for the shell document. */
  title?: string
  /** Extra `<head>` HTML injected before the Vite tags (e.g. an anti-flash theme script). */
  head?: string
  /** Serve the built assets at `base`. Set false if another route already does. Default true. */
  assets?: boolean
  /** Override the shell HTML. */
  html?(opts: { head: string, rootId: string, title?: string }): string
}

function defaultShell(opts: { head: string, rootId: string, title?: string }): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1">`
    + `${opts.title ? `<title>${opts.title}</title>` : ''}${opts.head}</head>`
    + `<body><div id="${opts.rootId}"></div></body></html>`
  )
}

/**
 * Serve a Vite-built SPA (Vue/React/Svelte + any router) with NO Inertia. Mounts
 * the built assets and returns the SPA shell (with Vite tags) for every route
 * under `prefix`, so client-side routing / deep links work. Pair it with your
 * JSON API (Resource + Bearer auth) on `/api`.
 *
 *   route().use(spa({ entry: 'frontend/spa.ts', prefix: '/dashboard' }))
 */
export function spa(options: SpaOptions) {
  const prefix = trimTrailing(options.prefix ?? '', '/')
  const rootId = options.rootId ?? 'app'
  const base = trimTrailing(options.base ?? '/build/', '/')
  const head = (options.head ?? '') + viteTags(options)
  const render = options.html ?? defaultShell
  const shell = () => render({ head, rootId, title: options.title })

  const serveShell = ({ set }: any) => {
    set.headers['content-type'] = 'text/html; charset=utf-8'
    return shell()
  }

  // Client-side deep links (e.g. /dashboard) have no server route, so they 404.
  // Serve the shell for those browser 404s via the error-page resolver — it's
  // only invoked for HTML navigations, so JSON API 404s still get JSON, and real
  // routes (the Better Auth handler, /api/*, assets) keep priority over a `/*`.
  configureErrorPage((status, { request }) => {
    if (status !== 404)
      return undefined
    const path = new URL(request.url).pathname
    if (path.startsWith('/api') || path.startsWith(base))
      return undefined
    return new Response(shell(), {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  })

  const app = new Elysia({ name: `elyvel-spa-${prefix || 'root'}` })
  if (options.assets !== false)
    app.use(staticFiles({ prefix: base, dir: options.buildDir ?? 'public/build' }))
  return app.get(prefix || '/', serveShell)
}
