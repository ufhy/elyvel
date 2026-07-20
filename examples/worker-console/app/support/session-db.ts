import type { SessionDbAdapter } from '@elyvel/core'
import { app } from '@elyvel/core'
import { table, transaction } from '@elyvel/database'

/**
 * `configureDatabaseSession` needs a raw storage adapter — same story as
 * cache-db.ts/queue-db.ts: never wired against a real connection anywhere in
 * the repo before this app.
 */
export const eloquentSessionAdapter: SessionDbAdapter = {
  async read(id) {
    const row = await table('sessions').where('id', '=', id).first()
    return row ? (row.payload as string) : undefined
  },

  async write(id, payload, lastActivity) {
    await transaction(async () => {
      const existing = await table('sessions').where('id', '=', id).first()
      if (existing)
        await table('sessions').where('id', '=', id).update({ payload, last_activity: lastActivity })
      else
        await table('sessions').insert({ id, payload, last_activity: lastActivity })
    })
  },

  async destroy(id) {
    await table('sessions').where('id', '=', id).delete()
  },

  async gc(nowMs) {
    const lifetimeMs = app().config.get<number>('session.lifetime', 7200) * 1000
    await table('sessions').where('last_activity', '<', nowMs - lifetimeMs).delete()
  },
}
