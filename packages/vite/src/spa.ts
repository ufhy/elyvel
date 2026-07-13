import { staticFiles } from '@elysia-ravel/core'
import { Elysia } from 'elysia'
import { viteTags, type ViteOptions } from './tags'

export interface SpaOptions extends ViteOptions {
  /** URL prefix the SPA is mounted at (client-side routes live under it). Default `/`. */
  prefix?: string
  /** Element id the client mounts on. Default `app`. */
  rootId?: string
  /** Directory of built assets to serve at `base`. Default `public/build`. */
  buildDir?: string
  /** `<title>` for the shell document. */
  title?: string
  /** Serve the built assets at `base`. Set false if another route already does. Default true. */
  assets?: boolean
  /** Override the shell HTML. */
  html?: (opts: { head: string; rootId: string; title?: string }) => string
}

function defaultShell(opts: { head: string; rootId: string; title?: string }): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `${opts.title ? `<title>${opts.title}</title>` : ''}${opts.head}</head>` +
    `<body><div id="${opts.rootId}"></div></body></html>`
  )
}

/**
 * Serve a Vite-built SPA (Vue/React/Svelte + any router) with NO Inertia. Mounts
 * the built assets and returns the SPA shell (with Vite tags) for every route
 * under `prefix`, so client-side routing / deep links work. Pair it with your
 * JSON API (Resource + Bearer auth) on `/api`.
 *
 *   route().use(spa({ entry: 'resources/js/spa.ts', prefix: '/dashboard' }))
 */
export function spa(options: SpaOptions) {
  const prefix = (options.prefix ?? '').replace(/\/+$/, '')
  const rootId = options.rootId ?? 'app'
  const base = (options.base ?? '/build/').replace(/\/+$/, '')
  const head = viteTags(options)
  const render = options.html ?? defaultShell
  const shell = () => render({ head, rootId, title: options.title })

  // biome-ignore lint/suspicious/noExplicitAny: Elysia context varies with hooks
  const serveShell = ({ set }: any) => {
    set.headers['content-type'] = 'text/html; charset=utf-8'
    return shell()
  }

  const app = new Elysia({ name: `ravel-spa-${prefix || 'root'}` })
  if (options.assets !== false) app.use(staticFiles({ prefix: base, dir: options.buildDir ?? 'public/build' }))
  return app.get(prefix || '/', serveShell).get(`${prefix}/*`, serveShell)
}
