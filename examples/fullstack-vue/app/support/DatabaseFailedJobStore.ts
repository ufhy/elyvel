import type { FailedJobAdapter, FailedJobRecord } from '@elyvel/queue'
import { table } from '@elyvel/database'

/**
 * Persists failed jobs in the `failed_jobs` table (migration:
 * `create_failed_jobs_table`) — Laravel's own `failed_jobs` table, just named
 * `uuid` for the app-facing id since `id` here is the table's own
 * auto-increment primary key.
 *
 * `@elyvel/queue`'s `FailedJobAdapter` is intentionally DB-agnostic (the
 * queue package doesn't depend on `@elyvel/database`), so this glue lives in
 * the app, wired via `configureFailedJobs(new DatabaseFailedJobStore())` in
 * `AppServiceProvider.boot()`.
 */
export class DatabaseFailedJobStore implements FailedJobAdapter {
  private query() {
    return table('failed_jobs')
  }

  async log(record: FailedJobRecord): Promise<void> {
    await this.query().insert({
      uuid: record.id,
      connection: record.connection,
      queue: record.queue,
      body: record.body,
      exception: record.exception,
      failed_at: record.failedAt,
    })
  }

  async all(): Promise<FailedJobRecord[]> {
    const rows = await this.query().orderBy('failed_at', 'desc').get()
    return rows.map(rowToRecord)
  }

  async find(id: string): Promise<FailedJobRecord | null> {
    const row = await this.query().where('uuid', id).first()
    return row ? rowToRecord(row) : null
  }

  async forget(id: string): Promise<boolean> {
    const existing = await this.find(id)
    if (!existing)
      return false
    await this.query().where('uuid', id).delete()
    return true
  }

  async flush(): Promise<void> {
    await this.query().delete()
  }

  async prune(beforeEpochMs: number): Promise<number> {
    const count = await this.query().where('failed_at', '<', beforeEpochMs).count()
    await this.query().where('failed_at', '<', beforeEpochMs).delete()
    return count
  }
}

function rowToRecord(row: Record<string, unknown>): FailedJobRecord {
  return {
    id: String(row.uuid),
    connection: String(row.connection),
    queue: String(row.queue),
    body: String(row.body),
    exception: String(row.exception),
    failedAt: Number(row.failed_at),
  }
}
