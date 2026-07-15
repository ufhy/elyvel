import { randomUUID } from 'node:crypto'
import type { Job } from './job'
import { dispatch } from './manager'

/**
 * Job batching (Laravel's `Bus::batch`). Dispatch a set of jobs as a batch,
 * track progress, and run `then`/`catch`/`finally` callbacks as it completes.
 * Callbacks are serialized via `toString()`, so they must be self-contained
 * (captured scope is not preserved). Requires a store via {@link configureBatches}.
 */
export interface BatchRecord {
  id: string
  name?: string
  total: number
  /** Jobs still to finish. `processed = total - pending`. */
  pending: number
  failed: number
  allowFailures: boolean
  cancelledAt: number | null
  finishedAt: number | null
  createdAt: number
  onThen?: string
  onCatch?: string
  onFinally?: string
}

/** DB-agnostic batch store (wired by the app via {@link configureBatches}). */
export interface BatchAdapter {
  create(record: BatchRecord): Promise<void>
  find(id: string): Promise<BatchRecord | null>
  /** Atomically `pending--` (and `failed++` when `success` is false); return the updated record. */
  recordJobResult(id: string, success: boolean): Promise<BatchRecord | null>
  cancel(id: string): Promise<void>
  markFinished(id: string): Promise<void>
}

/** In-memory batch store (per-process; dev/tests). */
export class MemoryBatchStore implements BatchAdapter {
  private records = new Map<string, BatchRecord>()
  async create(record: BatchRecord): Promise<void> {
    this.records.set(record.id, { ...record })
  }
  async find(id: string): Promise<BatchRecord | null> {
    const r = this.records.get(id)
    return r ? { ...r } : null
  }
  async recordJobResult(id: string, success: boolean): Promise<BatchRecord | null> {
    const r = this.records.get(id)
    if (!r) return null
    r.pending -= 1
    if (!success) r.failed += 1
    return { ...r }
  }
  async cancel(id: string): Promise<void> {
    const r = this.records.get(id)
    if (r) r.cancelledAt = Date.now()
  }
  async markFinished(id: string): Promise<void> {
    const r = this.records.get(id)
    if (r) r.finishedAt = Date.now()
  }
}

let adapter: BatchAdapter | null = null
export function configureBatches(store: BatchAdapter): void {
  adapter = store
}
export function batchAdapter(): BatchAdapter | null {
  return adapter
}
function requireAdapter(): BatchAdapter {
  if (!adapter) throw new Error('[elysia-ravel] Job batching needs configureBatches(adapter).')
  return adapter
}

/** A read model over a batch record, with progress helpers. */
export class Batch {
  constructor(private readonly record: BatchRecord) {}
  get id(): string {
    return this.record.id
  }
  get name(): string | undefined {
    return this.record.name
  }
  get total(): number {
    return this.record.total
  }
  get pending(): number {
    return this.record.pending
  }
  get processed(): number {
    return this.record.total - this.record.pending
  }
  get failed(): number {
    return this.record.failed
  }
  get cancelled(): boolean {
    return this.record.cancelledAt != null
  }
  get finished(): boolean {
    return this.record.finishedAt != null
  }
  /** Completion percentage (0–100). */
  progress(): number {
    return this.record.total ? Math.round((this.processed / this.record.total) * 100) : 0
  }
}

/** Look up a batch (e.g. to poll progress). */
export async function findBatch(id: string): Promise<Batch | null> {
  const record = await requireAdapter().find(id)
  return record ? new Batch(record) : null
}

type BatchCallback = (batch: Batch, error?: unknown) => void | Promise<void>

/** Builder returned by {@link Bus.batch}; configure then `dispatch()`. */
export class PendingBatch {
  private batchName: string | undefined
  private failuresAllowed = false
  private conn: string | undefined
  private targetQueue: string | undefined
  private thenCb: BatchCallback | undefined
  private catchCb: BatchCallback | undefined
  private finallyCb: BatchCallback | undefined

  constructor(private readonly jobs: Job[]) {}

  name(name: string): this {
    this.batchName = name
    return this
  }
  /** Dispatch the batch's jobs onto a specific connection (batches need a queued one, not sync). */
  onConnection(connection: string): this {
    this.conn = connection
    return this
  }
  /** Dispatch the batch's jobs onto a named queue. */
  onQueue(queue: string): this {
    this.targetQueue = queue
    return this
  }
  /** Let the batch keep running after a job fails (default: cancel on first failure). */
  allowFailures(allow = true): this {
    this.failuresAllowed = allow
    return this
  }
  // biome-ignore lint/suspicious/noThenProperty: Bus.batch fluent API (Laravel parity), not a thenable
  then(callback: BatchCallback): this {
    this.thenCb = callback
    return this
  }
  catch(callback: BatchCallback): this {
    this.catchCb = callback
    return this
  }
  finally(callback: BatchCallback): this {
    this.finallyCb = callback
    return this
  }

  /** Persist the batch and dispatch its jobs. Returns the initial {@link Batch}. */
  async dispatch(): Promise<Batch> {
    const record: BatchRecord = {
      id: randomUUID(),
      name: this.batchName,
      total: this.jobs.length,
      pending: this.jobs.length,
      failed: 0,
      allowFailures: this.failuresAllowed,
      cancelledAt: null,
      finishedAt: null,
      createdAt: Date.now(),
      onThen: this.thenCb?.toString(),
      onCatch: this.catchCb?.toString(),
      onFinally: this.finallyCb?.toString(),
    }
    await requireAdapter().create(record)
    for (const job of this.jobs) {
      job.batchId = record.id
      await dispatch(job, { connection: this.conn, queue: this.targetQueue })
    }
    return new Batch(record)
  }
}

export const Bus = {
  /** Start a batch of jobs. */
  batch(jobs: Job[]): PendingBatch {
    return new PendingBatch(jobs)
  },
}

// ── worker-side hooks ─────────────────────────────────────────────────────────
async function runCallback(
  source: string | undefined,
  batch: Batch,
  error?: unknown,
): Promise<void> {
  if (!source) return
  // biome-ignore lint/security/noGlobalEval: developer-authored batch callback, same trust as their code
  const fn = new Function(`return (${source})`)() as BatchCallback
  await fn(batch, error)
}

/** Has this batch been cancelled (so remaining jobs should be skipped)? */
export async function isBatchCancelled(id: string): Promise<boolean> {
  if (!adapter) return false
  const record = await adapter.find(id)
  return record?.cancelledAt != null
}

/**
 * Record a batched job's outcome and fire batch callbacks as thresholds are hit.
 * Called by the worker after a job that carries a `batchId`.
 */
export async function recordBatchedJob(
  id: string,
  success: boolean,
  error?: unknown,
): Promise<void> {
  if (!adapter) return
  const record = await adapter.recordJobResult(id, success)
  if (!record) return
  const batch = new Batch(record)

  // First failure with allowFailures off → cancel the batch and run catch.
  if (!success && !record.allowFailures && record.failed === 1 && record.cancelledAt == null) {
    await adapter.cancel(id)
    await runCallback(record.onCatch, batch, error)
  }

  // All jobs accounted for → run then (if clean) + finally, once.
  if (record.pending <= 0 && record.finishedAt == null) {
    await adapter.markFinished(id)
    if (record.failed === 0) await runCallback(record.onThen, batch)
    await runCallback(record.onFinally, batch)
  }
}
