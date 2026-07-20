import { route } from '@elyvel/core'
import { __, setRequestLocale } from '@elyvel/i18n'

export default route()
  .get('/hi', () => ({ msg: __('messages.hi', { name: 'Ada' }) }))
  // Uses the context-injected helpers (no import) — proves ctx.__ / ctx.locale.
  .get('/ctx', (ctx: any) => ({ locale: ctx.locale, msg: ctx.__('messages.hi', { name: 'Ada' }) }))
  // Mimics a real locale-detection hook: awaits (e.g. a DB/session lookup)
  // *before* calling setRequestLocale() — a SEPARATE later hook/handler must
  // still see it, on Bun (see setRequestLocale's doc comment).
  .get('/async-locale', () => ({ msg: __('messages.hi', { name: 'Ada' }) }), {
    beforeHandle: async (ctx: any) => {
      await new Promise(resolve => setTimeout(resolve, 5))
      setRequestLocale(new URL(ctx.request.url).searchParams.get('locale') ?? 'en')
    },
  })
