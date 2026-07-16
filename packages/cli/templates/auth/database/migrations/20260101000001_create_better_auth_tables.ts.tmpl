import type { Migration } from '@elysia-ravel/database'
import { migrateBetterAuth } from '@elysia-ravel/auth'
import { auth } from '../../app/better-auth'

/** Better Auth's tables (user/session/account/verification), created in Eloquent. */
export default {
  up: async (schema) => {
    await migrateBetterAuth(schema, auth.options)
  },
  down: async (schema) => {
    for (const t of ['verification', 'account', 'session', 'user']) await schema.dropIfExists(t)
  },
} satisfies Migration
