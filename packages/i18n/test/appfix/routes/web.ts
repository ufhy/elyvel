import { route } from '@elysia-ravel/core'
import { __ } from '@elysia-ravel/i18n'

export default route()
  .get('/hi', () => ({ msg: __('messages.hi', { name: 'Ada' }) }))
  // Uses the context-injected helpers (no import) — proves ctx.__ / ctx.locale.
  .get('/ctx', (ctx: any) => ({ locale: ctx.locale, msg: ctx.__('messages.hi', { name: 'Ada' }) }))
