import { randomUUID } from 'node:crypto'

export interface FailedJobRecord {
  id: string
  connection: string
  queue: string
  /** The serialized job body — exactly what gets re-pushed on retry. */
  body: string
  exception: string
  /** Epoch ms the job was recorded as failed. */
  failedAt: number
}

/**
 * Storage for failed jobs (kept DB-agnostic, wired by the app via
 * {@link configureFailedJobs}). Mirrors Laravel's `failed_jobs` table.
 */
export interface FailedJobAdapter {
  log(record: FailedJobRecord): Promise<void>
  all(): Promise<FailedJobRecord[]>
  find(id: string): Promise<FailedJobRecord | null>
  forget(id: string): Promise<boolean>
  flush(): Promise<void>
  /** Delete records failed before `beforeEpochMs`; returns how many were removed. */
  prune(beforeEpochMs: number): Promise<number>
}

/** Records and manages failed jobs. */
export class FailedJobRepository {
  constructor(private readonly adapter: FailedJobAdapter) {}

  /** Record a failed job; returns its new id. */
  async log(connection: string, queue: string, body: string, error: unknown): Promise<string> {
    const id = randomUUID()
    const exception = error instanceof Error ? (error.stack ?? error.message) : String(error)
    await this.adapter.log({ id, connection, queue, body, exception, failedAt: Date.now() })
    return id
  }

  all(): Promise<FailedJobRecord[]> {
    return this.adapter.all()
  }

  find(id: string): Promise<FailedJobRecord | null> {
    return this.adapter.find(id)
  }

  forget(id: string): Promise<boolean> {
    return this.adapter.forget(id)
  }

  flush(): Promise<void> {
    return this.adapter.flush()
  }

  /** Delete failed jobs older than `hours`; returns how many were removed. */
  prune(hours: number): Promise<number> {
    return this.adapter.prune(Date.now() - hours * 3600 * 1000)
  }
}

/** Built-in in-memory failed-job store (dev/tests). */
export class MemoryFailedJobStore implements FailedJobAdapter {
  private records: FailedJobRecord[] = []
  async log(record: FailedJobRecord): Promise<void> {
    this.records.push(record)
  }

  async all(): Promise<FailedJobRecord[]> {
    return [...this.records]
  }

  async find(id: string): Promise<FailedJobRecord | null> {
    return this.records.find(r => r.id === id) ?? null
  }

  async forget(id: string): Promise<boolean> {
    const before = this.records.length
    this.records = this.records.filter(r => r.id !== id)
    return this.records.length < before
  }

  async flush(): Promise<void> {
    this.records = []
  }

  async prune(beforeEpochMs: number): Promise<number> {
    const before = this.records.length
    this.records = this.records.filter(r => r.failedAt >= beforeEpochMs)
    return before - this.records.length
  }
}

// ── process-wide default (set by the app, e.g. in AppServiceProvider) ────────
let repository: FailedJobRepository | null = null
/** Wire failed-job storage. Without this, exhausted jobs are only logged, not persisted. */
export function configureFailedJobs(adapter: FailedJobAdapter): void {
  repository = new FailedJobRepository(adapter)
}
/** The configured failed-job repository, or null if none was wired. */
export function failedJobs(): FailedJobRepository | null {
  return repository
}
