import type { CacheDbAdapter } from '@elyvel/cache'
import { table, transaction } from '@elyvel/database'

/**
 * `configureDatabaseCache` needs a raw storage adapter — like the queue
 * adapter in queue-db.ts, this had never been wired against a real connection
 * anywhere in the repo before this app (only exercised in @elyvel/cache's
 * tests against fakes).
 */
export const eloquentCacheAdapter: CacheDbAdapter = {
  async read(key) {
    const row = await table('cache').where('key', '=', key).first()
    if (!row)
      return undefined
    return { value: row.value as string, expiresAt: row.expires_at as number | null }
  },

  async write(key, value, expiresAt) {
    await transaction(async () => {
      const existing = await table('cache').where('key', '=', key).first()
      if (existing)
        await table('cache').where('key', '=', key).update({ value, expires_at: expiresAt })
      else
        await table('cache').insert({ key, value, expires_at: expiresAt })
    })
  },

  async forget(key) {
    await table('cache').where('key', '=', key).delete()
  },

  async flush() {
    await table('cache').delete()
  },

  async increment(key, by) {
    return transaction(async () => {
      const existing = await table('cache').where('key', '=', key).first()
      const next = (existing ? Number(existing.value) : 0) + by
      if (existing)
        await table('cache').where('key', '=', key).update({ value: String(next), expires_at: null })
      else
        await table('cache').insert({ key, value: String(next), expires_at: null })
      return next
    })
  },
}
