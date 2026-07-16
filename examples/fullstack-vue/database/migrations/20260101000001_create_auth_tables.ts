import type { Migration } from '@elysia-ravel/database'
import { migrateBetterAuth } from '@elysia-ravel/auth'
import { auth } from '../../config/auth'

/**
 * Better Auth's tables (users, sessions, accounts, verifications), created in
 * Eloquent. `migrateBetterAuth` derives them from the enabled plugins, so the
 * twoFactor() plugin adds the `twoFactor` table (+ a users.twoFactorEnabled
 * flag) automatically. Table names come from `config/auth.ts` (plural).
 */
export default {
  up: async (schema) => {
    await migrateBetterAuth(schema, auth.options)
  },
  down: async (schema) => {
    for (const t of ['twoFactor', 'verifications', 'accounts', 'sessions', 'users'])
      await schema.dropIfExists(t)
  },
} satisfies Migration
