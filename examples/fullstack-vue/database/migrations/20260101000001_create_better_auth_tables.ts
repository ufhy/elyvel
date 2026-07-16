import type { Migration } from '@elysia-ravel/database'
import { migrateBetterAuth } from '@elysia-ravel/auth'
import { auth } from '../../config/auth'

/**
 * Better Auth's tables, created in Eloquent. `migrateBetterAuth` derives them
 * from the enabled plugins, so the twoFactor() plugin adds the `twoFactor`
 * table (+ a user.twoFactorEnabled flag) automatically.
 */
export default {
  up: async (schema) => {
    await migrateBetterAuth(schema, auth.options)
  },
  down: async (schema) => {
    for (const t of ['twoFactor', 'verification', 'account', 'session', 'user'])
      await schema.dropIfExists(t)
  },
} satisfies Migration
