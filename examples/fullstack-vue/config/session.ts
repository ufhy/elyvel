import { defineSessionConfig } from '@elysia-ravel/core'

/**
 * Session config. The `cookie` driver stores the (encrypted) session in a
 * cookie — no table needed. Secret defaults to `app.key`.
 */
export default defineSessionConfig({
  driver: 'cookie',
  cookie: 'ravel_session',
  lifetime: 60 * 120, // 2 hours
})
