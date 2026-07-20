import type { FailedJobAdapter, FailedJobRecord, QueueDbAdapter } from '@elyvel/queue'
import { table, transaction } from '@elyvel/database'

/**
 * `configureDatabaseQueue`/`configureFailedJobs` need a raw storage adapter —
 * this app is the first to actually wire one against a real connection
 * (previously only exercised in @elyvel/queue's tests against fakes). Built on
 * the plain `table()` query builder, not Eloquent, since jobs/failed_jobs
 * aren't domain models.
 */
export const eloquentQueueAdapter: QueueDbAdapter = {
  async insert(id, body, attempts, availableAt, queue) {
    await table('jobs').insert({ id, body, attempts, available_at: availableAt, queue })
  },

  async takeReady(now, queues) {
    return transaction(async () => {
      const row = await table('jobs')
        .whereIn('queue', queues)
        .where('available_at', '<=', now)
        .orderBy('available_at')
        .first()
      if (!row)
        return null
      await table('jobs').where('id', row.id as string).delete()
      return {
        id: row.id as string,
        body: row.body as string,
        attempts: row.attempts as number,
        queue: row.queue as string,
      }
    })
  },

  async count(queue) {
    const query = table('jobs')
    if (queue)
      query.where('queue', '=', queue)
    return query.count()
  },
}

export const eloquentFailedJobAdapter: FailedJobAdapter = {
  async log(record) {
    await table('failed_jobs').insert({
      id: record.id,
      connection: record.connection,
      queue: record.queue,
      body: record.body,
      exception: record.exception,
      failed_at: record.failedAt,
    })
  },

  async all() {
    const rows = await table('failed_jobs').orderBy('failed_at', 'desc').get()
    return rows.map(toRecord)
  },

  async find(id) {
    const row = await table('failed_jobs').where('id', '=', id).first()
    return row ? toRecord(row) : null
  },

  async forget(id) {
    const existing = await table('failed_jobs').where('id', '=', id).first()
    if (!existing)
      return false
    await table('failed_jobs').where('id', '=', id).delete()
    return true
  },

  async flush() {
    await table('failed_jobs').delete()
  },

  async prune(beforeEpochMs) {
    const stale = await table('failed_jobs').where('failed_at', '<', beforeEpochMs).get()
    await table('failed_jobs').where('failed_at', '<', beforeEpochMs).delete()
    return stale.length
  },
}

function toRecord(row: Record<string, unknown>): FailedJobRecord {
  return {
    id: row.id as string,
    connection: row.connection as string,
    queue: row.queue as string,
    body: row.body as string,
    exception: row.exception as string,
    failedAt: row.failed_at as number,
  }
}
