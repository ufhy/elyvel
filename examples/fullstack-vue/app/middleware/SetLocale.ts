import type { MiddlewareContext } from '@elyvel/core'
import { Middleware } from '@elyvel/core'
import { setRequestLocale } from '@elyvel/i18n'

/**
 * Pick the request's locale from `?lang=` (or the `Accept-Language` header),
 * falling back to the app default. Registered as global middleware, so every
 * response — including validation errors — comes back in the chosen language.
 *
 * `setRequestLocale` is request-scoped (safe under concurrency); it works here
 * because `I18nServiceProvider` opens the request scope in `onRequest`, before
 * global middleware runs.
 */
const SUPPORTED = ['en', 'id']

export class SetLocale extends Middleware {
  handle(ctx: MiddlewareContext): void {
    const fromQuery = typeof ctx.query.lang === 'string' ? ctx.query.lang : undefined
    const fromHeader = ctx.request.headers.get('accept-language')?.split(',')[0]?.trim().slice(0, 2)
    const locale = fromQuery ?? fromHeader
    if (locale && SUPPORTED.includes(locale))
      setRequestLocale(locale)
  }
}

export default SetLocale
