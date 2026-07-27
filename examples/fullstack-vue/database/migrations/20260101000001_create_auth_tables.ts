import type { Migration } from '@elyvel/database'
import { AuthToken, migrateBetterAuth } from '@elyvel/auth'
import { app } from '@elyvel/core'

/**
 * Better Auth's tables (users, sessions, accounts, verifications), created in
 * Eloquent. `migrateBetterAuth` derives them from the enabled plugins, so the
 * twoFactor() plugin adds the `twoFactor` table (+ a users.twoFactorEnabled
 * flag) automatically. Table names come from `config/auth.ts` (plural).
 *
 * Adding a plugin LATER (after this has already run)? Don't edit this file —
 * add the plugin to `config/auth.ts`, then run `elyvel auth:generate-migration-plugin` to
 * generate a migration that re-runs this. It's idempotent/incremental:
 * existing tables are left alone except for any columns the new plugin adds,
 * and a wholly new plugin table gets created.
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
