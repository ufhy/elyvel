import { Elysia } from 'elysia'
import { FileResponse } from './file'
import { RedirectResponse } from './redirect'

/**
 * Normalizes framework response objects returned from handlers into real HTTP
 * responses. Currently turns a {@link RedirectResponse} into a 303 with a
 * `Location` header and applies its session flashes.
 *
 * Mounted BEFORE the session plugin so flashes land before the session is aged
 * and persisted on the way out.
 */
export function httpResponses() {
  return new Elysia({ name: 'ravel-http-responses' }).onAfterHandle(
    { as: 'global' },
    (ctx: any) => {
      const response = ctx.response
      if (response instanceof RedirectResponse) {
        response.applyFlash(ctx.session)
        ctx.set.status = response.status
        ctx.set.headers.location = response.location(ctx.request)
        return ''
      }
      if (response instanceof FileResponse) {
        const { source, options } = response
        const name =
          options.name ?? (options.fromPath ? String(source).split('/').pop() : undefined)
        if (options.contentType) ctx.set.headers['content-type'] = options.contentType
        if (options.disposition === 'attachment' || name) {
          ctx.set.headers['content-disposition'] =
            `${options.disposition}${name ? `; filename="${name}"` : ''}`
        }
        return options.fromPath ? Bun.file(source as string) : source
      }
      // A view response (from @elysia-ravel/view) — duck-typed so core stays
      // decoupled. Build shared data from the session and render to text/html.
      if (response && typeof response === 'object' && response.__ravelView === true) {
        const session = ctx.session
        const oldInput = (session?.get?.('_old_input') ?? {}) as Record<string, unknown>
        const shared = {
          errors: (session?.get?.('errors') ?? {}) as Record<string, string[]>,
          old: (key: string, fallback?: unknown) => oldInput[key] ?? fallback,
          flash: (key: string, fallback?: unknown) => session?.get?.(key) ?? fallback,
          csrf: session?.token?.() ?? '',
        }
        ctx.set.status = response.statusCode ?? 200
        ctx.set.headers['content-type'] = 'text/html; charset=utf-8'
        return response.render(shared)
      }
      return undefined
    },
  )
}
