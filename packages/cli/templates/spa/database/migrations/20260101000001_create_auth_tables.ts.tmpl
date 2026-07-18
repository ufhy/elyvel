import type { Migration } from '@elyvel/database'
import { AuthToken, migrateBetterAuth } from '@elyvel/auth'
import { app } from '@elyvel/core'

/**
 * Better Auth's tables (users, sessions, accounts, verifications), created in
 * Eloquent. `migrateBetterAuth` derives them from the enabled plugins, so the
 * twoFactor() plugin adds the `twoFactor` table (+ a users.twoFactorEnabled
 * flag) automatically. Table names come from `config/auth.ts` (plural).
 */
export default {
  up: async (schema) => {
    await migrateBetterAuth(schema, app(AuthToken).options)
  },
  down: async (schema) => {
    for (const t of ['twoFactor', 'verifications', 'accounts', 'sessions', 'users'])
      await schema.dropIfExists(t)
  },
} satisfies Migration
