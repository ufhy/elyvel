import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { Elysia } from 'elysia'
import { buildProps, InertiaLocation, InertiaResponse, type Page } from './response'
import { viteTags, type ViteOptions } from './vite'

/** What an Inertia SSR bundle's default export returns for a page. */
export interface SsrResult {
  head: string[]
  body: string
}

export interface SsrOptions {
  /** Path to the built SSR bundle (Vite `--ssr` output), e.g. `public/build/ssr/ssr.js`. */
  bundle?: string
  /** Render function (bypasses `bundle` — handy for tests). */
  render?: (page: Page) => Promise<SsrResult> | SsrResult
}

export interface InertiaConfig {
  /** Asset version — a mismatch triggers a full reload (409 + X-Inertia-Location). */
  version?: string | (() => string)
  /** Root element id the client mounts on. Default `app`. */
  rootId?: string
  /** Vite integration for the first-load document's asset tags. */
  vite?: ViteOptions
  /** Server-side rendering — render the page to HTML on first load, then hydrate. */
  ssr?: SsrOptions
  /** Override the full HTML document for a first (non-XHR) load. */
  html?: (opts: {
    pageJson: string
    page: Page
    rootId: string
    head: string
    ssr?: SsrResult
  }) => string
}

const escapeAttr = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;')

function defaultHtml(opts: { pageJson: string; rootId: string; head: string; ssr?: SsrResult }): string {
  // With SSR, `ssr.body` already contains the rendered `<div id=app data-page>`;
  // otherwise emit an empty root div the client fills.
  const app = opts.ssr ? opts.ssr.body : `<div id="${opts.rootId}" data-page="${escapeAttr(opts.pageJson)}"></div>`
  const ssrHead = opts.ssr ? opts.ssr.head.join('') : ''
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">${ssrHead}${opts.head}</head>` +
    `<body>${app}</body></html>`
  )
}

/** Import + cache an SSR bundle's default render function. */
let ssrRenderCache: ((page: Page) => Promise<SsrResult> | SsrResult) | null = null
async function loadSsrRender(bundle: string): Promise<((page: Page) => Promise<SsrResult> | SsrResult) | null> {
  if (ssrRenderCache) return ssrRenderCache
  const abs = isAbsolute(bundle) ? bundle : resolve(process.cwd(), bundle)
  if (!existsSync(abs)) return null
  const mod = (await import(abs)) as { default?: (page: Page) => Promise<SsrResult> | SsrResult }
  ssrRenderCache = mod.default ?? null
  return ssrRenderCache
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
    const built = await buildProps(response, request, ctx.session)
    const page: Page = {
      component: response.component,
      props: built.props,
      url: url.pathname + url.search,
      version,
    }
    if (built.deferredProps) page.deferredProps = built.deferredProps
    if (built.mergeProps) page.mergeProps = built.mergeProps
    if (built.deepMergeProps) page.deepMergeProps = built.deepMergeProps
    if (built.prependProps) page.prependProps = built.prependProps
    if (built.matchPropsOn) page.matchPropsOn = built.matchPropsOn
    if (built.onceProps) page.onceProps = built.onceProps
    if (built.rescuedProps) page.rescuedProps = built.rescuedProps
    if (response.encryptHistoryFlag) page.encryptHistory = true
    if (response.clearHistoryFlag) page.clearHistory = true
    if (response.preserveFragmentFlag) page.preserveFragment = true

    if (isInertia) {
      ctx.set.headers['x-inertia'] = 'true'
      ctx.set.headers.vary = 'X-Inertia'
      return page // Elysia serializes to JSON
    }

    // First load: optionally server-render the page, then hydrate on the client.
    let ssr: SsrResult | undefined
    if (config.ssr) {
      try {
        const render = config.ssr.render ?? (config.ssr.bundle ? await loadSsrRender(config.ssr.bundle) : null)
        if (render) ssr = await render(page)
      } catch {
        ssr = undefined // fall back to client-only rendering
      }
    }

    ctx.set.headers['content-type'] = 'text/html; charset=utf-8'
    return renderHtml({ pageJson: JSON.stringify(page), page, rootId, head, ssr })
  })
}
