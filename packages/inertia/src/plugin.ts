import { Elysia } from 'elysia'
import { buildProps, InertiaLocation, InertiaResponse, type Page } from './response'
import { viteTags, type ViteOptions } from './vite'

export interface InertiaConfig {
  /** Asset version — a mismatch triggers a full reload (409 + X-Inertia-Location). */
  version?: string | (() => string)
  /** Root element id the client mounts on. Default `app`. */
  rootId?: string
  /** Vite integration for the first-load document's asset tags. */
  vite?: ViteOptions
  /** Override the full HTML document for a first (non-XHR) load. */
  html?: (opts: { pageJson: string; page: Page; rootId: string; head: string }) => string
}

const escapeAttr = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;')

function defaultHtml(opts: { pageJson: string; rootId: string; head: string }): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">${opts.head}</head>` +
    `<body><div id="${opts.rootId}" data-page="${escapeAttr(opts.pageJson)}"></div></body></html>`
  )
}

/**
 * Inertia server adapter. Turns an {@link InertiaResponse} (from `Inertia.render`)
 * into either a JSON page object (for `X-Inertia` XHR visits) or a full HTML
 * document that boots the client (first load). Handles asset-version reloads,
 * partial reloads, shared props, and flashed validation errors.
 */
export function inertia(config: InertiaConfig = {}) {
  const rootId = config.rootId ?? 'app'
  const resolveVersion = () => (typeof config.version === 'function' ? config.version() : (config.version ?? ''))
  const renderHtml = config.html ?? ((o) => defaultHtml(o))
  const head = config.vite ? viteTags(config.vite) : ''

  // Scoped so mounting `.use(inertia())` in a route file applies to that file's
  // routes (like requestContext/auth.guard) — no app-level global mount needed.
  // biome-ignore lint/suspicious/noExplicitAny: Elysia context varies with hooks
  return new Elysia({ name: 'ravel-inertia' }).onAfterHandle({ as: 'scoped' }, async (ctx: any) => {
    const response = ctx.response
    const request = ctx.request as Request
    const isInertia = request.headers.get('x-inertia') === 'true'

    // Force-visit a URL: 409 for Inertia XHR (client does a hard visit), 302 otherwise.
    if (response instanceof InertiaLocation) {
      if (isInertia) {
        ctx.set.status = 409
        ctx.set.headers['x-inertia-location'] = response.url
      } else {
        ctx.set.status = 302
        ctx.set.headers.location = response.url
      }
      return ''
    }

    if (!(response instanceof InertiaResponse)) return undefined

    const version = resolveVersion()

    // Asset version changed between navigations → tell the client to hard-reload.
    if (isInertia && request.method === 'GET' && (request.headers.get('x-inertia-version') ?? '') !== version) {
      ctx.set.status = 409
      ctx.set.headers['x-inertia-location'] = request.url
      return ''
    }

    const url = new URL(request.url)
    const props = await buildProps(response, request, ctx.session)
    const page: Page = { component: response.component, props, url: url.pathname + url.search, version }

    if (isInertia) {
      ctx.set.headers['x-inertia'] = 'true'
      ctx.set.headers.vary = 'X-Inertia'
      return page // Elysia serializes to JSON
    }
    ctx.set.headers['content-type'] = 'text/html; charset=utf-8'
    return renderHtml({ pageJson: JSON.stringify(page), page, rootId, head })
  })
}
