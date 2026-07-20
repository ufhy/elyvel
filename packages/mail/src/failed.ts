import { randomUUID } from 'node:crypto'

export interface FailedMailRecord {
  id: string
  mailer: string
  /** JSON-serialized `{ to, cc, bcc, subject }` — enough to see what was being sent. */
  message: string
  exception: string
  /** Epoch ms the send was recorded as failed. */
  failedAt: number
}

/**
 * Storage for mail sends that threw (kept DB-agnostic, wired by the app via
 * {@link configureFailedMail}). Without this, a failed SMTP/API send is only
 * ever visible as a thrown error at the call site — nothing records it for
 * later inspection or retry. Mirrors `@elyvel/queue`'s `FailedJobAdapter`.
 */
export interface FailedMailAdapter {
  log(record: FailedMailRecord): Promise<void>
  all(): Promise<FailedMailRecord[]>
  find(id: string): Promise<FailedMailRecord | null>
  forget(id: string): Promise<boolean>
  flush(): Promise<void>
  /** Delete records failed before `beforeEpochMs`; returns how many were removed. */
  prune(beforeEpochMs: number): Promise<number>
}

/** Records and manages failed mail sends. */
export class FailedMailRepository {
  constructor(private readonly adapter: FailedMailAdapter) {}

  /** Record a failed send; returns its new id. */
  async log(mailer: string, message: string, error: unknown): Promise<string> {
    const id = randomUUID()
    const exception = error instanceof Error ? (error.stack ?? error.message) : String(error)
    await this.adapter.log({ id, mailer, message, exception, failedAt: Date.now() })
    return id
  }

  all(): Promise<FailedMailRecord[]> {
    return this.adapter.all()
  }

  find(id: string): Promise<FailedMailRecord | null> {
    return this.adapter.find(id)
  }

  forget(id: string): Promise<boolean> {
    return this.adapter.forget(id)
  }

  flush(): Promise<void> {
    return this.adapter.flush()
  }

  /** Delete failed records older than `hours`; returns how many were removed. */
  prune(hours: number): Promise<number> {
    return this.adapter.prune(Date.now() - hours * 3600 * 1000)
  }
}

/** Built-in in-memory failed-mail store (dev/tests). */
export class MemoryFailedMailStore implements FailedMailAdapter {
  private records: FailedMailRecord[] = []
  async log(record: FailedMailRecord): Promise<void> {
    this.records.push(record)
  }

  async all(): Promise<FailedMailRecord[]> {
    return [...this.records]
  }

  async find(id: string): Promise<FailedMailRecord | null> {
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
let repository: FailedMailRepository | null = null
/** Wire failed-mail storage. Without this, a failed send is only ever a thrown error. */
export function configureFailedMail(adapter: FailedMailAdapter): void {
  repository = new FailedMailRepository(adapter)
}
/** The configured failed-mail repository, or null if none was wired. */
export function failedMail(): FailedMailRepository | null {
  return repository
}
