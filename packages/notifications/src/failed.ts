import { randomUUID } from 'node:crypto'

export interface FailedNotificationRecord {
  id: string
  notifiableType: string
  notifiableId: string
  channel: string
  notification: string
  exception: string
  /** Epoch ms the send was recorded as failed. */
  failedAt: number
}

/**
 * Storage for notification sends that threw on a given channel (kept
 * DB-agnostic, wired by the app via {@link configureFailedNotifications}).
 * Mirrors `@elyvel/queue`'s `FailedJobAdapter` / `@elyvel/mail`'s
 * `FailedMailAdapter`.
 */
export interface FailedNotificationAdapter {
  log(record: FailedNotificationRecord): Promise<void>
  all(): Promise<FailedNotificationRecord[]>
  find(id: string): Promise<FailedNotificationRecord | null>
  forget(id: string): Promise<boolean>
  flush(): Promise<void>
  /** Delete records failed before `beforeEpochMs`; returns how many were removed. */
  prune(beforeEpochMs: number): Promise<number>
}

/** Records and manages failed notification sends. */
export class FailedNotificationRepository {
  constructor(private readonly adapter: FailedNotificationAdapter) {}

  /** Record a failed send; returns its new id. */
  async log(
    notifiableType: string,
    notifiableId: string,
    channel: string,
    notification: string,
    error: unknown,
  ): Promise<string> {
    const id = randomUUID()
    const exception = error instanceof Error ? (error.stack ?? error.message) : String(error)
    await this.adapter.log({ id, notifiableType, notifiableId, channel, notification, exception, failedAt: Date.now() })
    return id
  }

  all(): Promise<FailedNotificationRecord[]> {
    return this.adapter.all()
  }

  find(id: string): Promise<FailedNotificationRecord | null> {
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

/** Built-in in-memory failed-notification store (dev/tests). */
export class MemoryFailedNotificationStore implements FailedNotificationAdapter {
  private records: FailedNotificationRecord[] = []
  async log(record: FailedNotificationRecord): Promise<void> {
    this.records.push(record)
  }

  async all(): Promise<FailedNotificationRecord[]> {
    return [...this.records]
  }

  async find(id: string): Promise<FailedNotificationRecord | null> {
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
let repository: FailedNotificationRepository | null = null
/** Wire failed-notification storage. Without this, a failed send is only ever a thrown error. */
export function configureFailedNotifications(adapter: FailedNotificationAdapter): void {
  repository = new FailedNotificationRepository(adapter)
}
/** The configured failed-notification repository, or null if none was wired. */
export function failedNotifications(): FailedNotificationRepository | null {
  return repository
}
