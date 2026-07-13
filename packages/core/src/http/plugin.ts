import { Elysia } from 'elysia'
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
  // biome-ignore lint/suspicious/noExplicitAny: Elysia's context type varies with hooks
  return new Elysia({ name: 'ravel-http-responses' }).onAfterHandle({ as: 'global' }, (ctx: any) => {
    const response = ctx.response
    if (response instanceof RedirectResponse) {
      response.applyFlash(ctx.session)
      ctx.set.status = response.status
      ctx.set.headers.location = response.location(ctx.request)
      return ''
    }
    return undefined
  })
}
