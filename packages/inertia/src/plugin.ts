import type { ViteOptions } from '@elyvel/vite'
import type { Page } from './response'
import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { viteTags } from '@elyvel/vite'
import { Elysia } from 'elysia'
import { buildProps, freshSharedScope, InertiaLocation, InertiaResponse } from './response'

/** What an Inertia SSR bundle's default export returns for a page. */
export interface SsrResult {
  head: string[]
  body: string
}

export interface SsrOptions {
  /** Path to the built SSR bundle (Vite `--ssr` output), e.g. `public/build/ssr/ssr.js`. */
  bundle?: string
  /** Render function (bypasses `bundle` — handy for tests). */
  render?(page: Page): Promise<SsrResult> | SsrResult
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
  /**
   * Extra markup injected into `<head>` of the first-load document, before the
   * Vite tags. Handy for an inline anti-flash theme script (set `.dark` on
   * `<html>` from the stored preference before the body paints).
   */
  head?: string
  /** Override the full HTML document for a first (non-XHR) load. */
  html?(opts: {
    pageJson: string
    page: Page
    rootId: string
    head: string
    ssr?: SsrResult
  }): string
}

/** Escape a JSON string for safe embedding inside a `<script>` element. */
function scriptJson(value: string): string {
  return value.replace(/</g, '\\u003c')
}

function defaultHtml(opts: {
  pageJson: string
  rootId: string
  head: string
  ssr?: SsrResult
}): string {
  // With SSR, `ssr.body` already contains the rendered mount + page. Otherwise
  // emit an empty root the client mounts into, plus the initial page as a
  // `<script type="application/json" data-page>` — the format Inertia v3 reads
  // (v1/v2's `<div id data-page>` is ignored by the v3 client → blank page).
  const app = opts.ssr
    ? opts.ssr.body
    : `<div id="${opts.rootId}"></div>`
      + `<script type="application/json" data-page="${opts.rootId}">${scriptJson(opts.pageJson)}</script>`
  const ssrHead = opts.ssr ? opts.ssr.head.join('') : ''
  return (
    `<!doctype html><html><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1">${ssrHead}${opts.head}</head>`
    + `<body>${app}</body></html>`
  )
}

/** Import + cache an SSR bundle's default render function. */
let ssrRenderCache: ((page: Page) => Promise<SsrResult> | SsrResult) | null = null
async function loadSsrRender(
  bundle: string,
): Promise<((page: Page) => Promise<SsrResult> | SsrResult) | null> {
  if (ssrRenderCache)
    return ssrRenderCache
  const abs = isAbsolute(bundle) ? bundle : resolve(process.cwd(), bundle)
  if (!existsSync(abs))
    return null
  const mod = (await import(abs)) as { default?(page: Page): Promise<SsrResult> | SsrResult }
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
  const resolveVersion = () =>
    typeof config.version === 'function' ? config.version() : (config.version ?? '')
  const renderHtml = config.html ?? (o => defaultHtml(o))
  const head = (config.head ?? '') + (config.vite ? viteTags(config.vite) : '')

  // Global so a single registration (config/middleware.ts `global`) transforms
  // Inertia responses across every route file — no per-file `.use` needed.
  return new Elysia({ name: 'elyvel-inertia' })
    // Fresh shared-prop scope per request, established before any middleware/
    // handler runs — so `Inertia.share('user', ctx.user)` called from within
    // this request can't leak into or get clobbered by a concurrent one.
    .onRequest(() => freshSharedScope())
    .onAfterHandle({ as: 'global' }, async (ctx: any) => {
      const response = ctx.response
      const request = ctx.request as Request
      const isInertia = request.headers.get('x-inertia') === 'true'

      // Force-visit a URL: 409 for Inertia XHR (client does a hard visit), 302 otherwise.
      if (response instanceof InertiaLocation) {
        if (isInertia) {
          ctx.set.status = 409
          ctx.set.headers['x-inertia-location'] = response.url
        }
        else {
          ctx.set.status = 302
          ctx.set.headers.location = response.url
        }
        return ''
      }

      if (!(response instanceof InertiaResponse))
        return undefined

      const version = resolveVersion()

      // Asset version changed between navigations → tell the client to hard-reload.
      if (
        isInertia
        && request.method === 'GET'
        && (request.headers.get('x-inertia-version') ?? '') !== version
      ) {
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
        // Not yet implemented (no flash-message sharing / client-remembered-state
        // round-trip) — honestly empty rather than omitted, since the Inertia
        // client's own Page<T> type requires both fields on every response.
        flash: {},
        rememberedState: {},
        rescuedProps: built.rescuedProps,
      }
      if (built.deferredProps)
        page.deferredProps = built.deferredProps
      if (built.mergeProps)
        page.mergeProps = built.mergeProps
      if (built.deepMergeProps)
        page.deepMergeProps = built.deepMergeProps
      if (built.prependProps)
        page.prependProps = built.prependProps
      if (built.matchPropsOn)
        page.matchPropsOn = built.matchPropsOn
      if (built.onceProps)
        page.onceProps = built.onceProps
      if (response.encryptHistoryFlag)
        page.encryptHistory = true
      if (response.clearHistoryFlag)
        page.clearHistory = true
      if (response.preserveFragmentFlag)
        page.preserveFragment = true

      if (isInertia) {
        ctx.set.headers['x-inertia'] = 'true'
        ctx.set.headers.vary = 'X-Inertia'
        return page // Elysia serializes to JSON
      }

      // First load: optionally server-render the page, then hydrate on the client.
      let ssr: SsrResult | undefined
      if (config.ssr) {
        try {
          const render
            = config.ssr.render ?? (config.ssr.bundle ? await loadSsrRender(config.ssr.bundle) : null)
          if (render)
            ssr = await render(page)
        }
        catch {
          ssr = undefined // fall back to client-only rendering
        }
      }

      ctx.set.headers['content-type'] = 'text/html; charset=utf-8'
      return renderHtml({ pageJson: JSON.stringify(page), page, rootId, head, ssr })
    })
}
