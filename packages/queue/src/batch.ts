import type { Job } from './job'
import type { RedisLike } from './store'
import { randomUUID } from 'node:crypto'
import { packSignedClosure, unpackSignedClosure } from './closure-signing'
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
  /**
   * Mark the batch cancelled, returning whether THIS call performed the
   * transition (false if it was already cancelled).
   *
   * The boolean is what makes "run the catch callback once" safe. Deciding it
   * from a previously-read record can't work: several workers failing at the
   * same moment all read a record that already counts every failure, so a
   * "was this the first?" test is false for all of them and the batch is never
   * cancelled at all.
   */
  cancel(id: string): Promise<boolean>
  /**
   * Mark the batch finished, returning whether THIS call performed the
   * transition — the gate for running `then`/`finally` exactly once when
   * concurrent workers both observe `pending` reaching zero.
   */
  markFinished(id: string): Promise<boolean>
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
    if (!r)
      return null
    r.pending -= 1
    if (!success)
      r.failed += 1
    return { ...r }
  }

  async cancel(id: string): Promise<boolean> {
    const r = this.records.get(id)
    if (!r || r.cancelledAt !== null)
      return false
    r.cancelledAt = Date.now()
    return true
  }

  async markFinished(id: string): Promise<boolean> {
    const r = this.records.get(id)
    if (!r || r.finishedAt !== null)
      return false
    r.finishedAt = Date.now()
    return true
  }
}

/**
 * Redis-backed batch store — makes `Bus.batch()` progress/cancellation state
 * visible across worker processes. `MemoryBatchStore` only lives within a
 * single process, so a batch dispatched from one process and processed by
 * workers in others would never see correct completion — same bug class as
 * the other 7 fixes this session.
 *
 * Each field lives under its own key so the correctness-critical mutation —
 * "atomically `pending--` (and `failed++` when not successful)" per
 * `recordJobResult`'s own contract — uses Redis's native atomic `DECRBY`/
 * `INCR` directly, rather than a read-modify-write race like
 * `MemoryBatchStore`'s single in-process object would have if it were shared.
 */
export class RedisBatchStore implements BatchAdapter {
  constructor(
    private readonly client: RedisLike,
    private readonly prefix = 'batch:',
  ) {}

  private key(id: string, field: string): string {
    return `${this.prefix}${id}:${field}`
  }

  async create(record: BatchRecord): Promise<void> {
    const meta = {
      name: record.name,
      total: record.total,
      allowFailures: record.allowFailures,
      createdAt: record.createdAt,
      onThen: record.onThen,
      onCatch: record.onCatch,
      onFinally: record.onFinally,
    }
    await this.client.send('SET', [this.key(record.id, 'meta'), JSON.stringify(meta)])
    await this.client.send('SET', [this.key(record.id, 'pending'), String(record.pending)])
    await this.client.send('SET', [this.key(record.id, 'failed'), String(record.failed)])
  }

  async find(id: string): Promise<BatchRecord | null> {
    const metaRaw = (await this.client.send('GET', [this.key(id, 'meta')])) as string | null
    if (!metaRaw)
      return null
    const meta = JSON.parse(metaRaw) as Omit<BatchRecord, 'id' | 'pending' | 'failed' | 'cancelledAt' | 'finishedAt'>
    const pending = Number((await this.client.send('GET', [this.key(id, 'pending')])) ?? 0)
    const failed = Number((await this.client.send('GET', [this.key(id, 'failed')])) ?? 0)
    const cancelledAt = (await this.client.send('GET', [this.key(id, 'cancelledAt')])) as string | null
    const finishedAt = (await this.client.send('GET', [this.key(id, 'finishedAt')])) as string | null
    return {
      id,
      ...meta,
      pending,
      failed,
      cancelledAt: cancelledAt ? Number(cancelledAt) : null,
      finishedAt: finishedAt ? Number(finishedAt) : null,
    }
  }

  async recordJobResult(id: string, success: boolean): Promise<BatchRecord | null> {
    const exists = await this.client.send('GET', [this.key(id, 'meta')])
    if (!exists)
      return null
    // Take the counters from DECRBY/INCR's own replies. Re-reading them with a
    // separate `find()` meant two workers finishing at once both saw
    // `pending: 0` (and, on the failure path, both saw `failed` already past
    // 1) — so `then`/`finally` ran twice while `catch` ran not at all.
    const pending = Number(await this.client.send('DECRBY', [this.key(id, 'pending'), '1']))
    const failed = success
      ? Number((await this.client.send('GET', [this.key(id, 'failed')])) ?? 0)
      : Number(await this.client.send('INCR', [this.key(id, 'failed')]))
    const record = await this.find(id)
    return record ? { ...record, pending, failed } : null
  }

  async cancel(id: string): Promise<boolean> {
    // NX: only the first caller transitions, so `catch` runs once.
    const reply = await this.client.send('SET', [
      this.key(id, 'cancelledAt'),
      String(Date.now()),
      'NX',
    ])
    return reply !== null && reply !== undefined
  }

  async markFinished(id: string): Promise<boolean> {
    const reply = await this.client.send('SET', [
      this.key(id, 'finishedAt'),
      String(Date.now()),
      'NX',
    ])
    return reply !== null && reply !== undefined
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
  if (!adapter)
    throw new Error('[elyvel] Job batching needs configureBatches(adapter).')
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
      onThen: this.thenCb && packSignedClosure(this.thenCb.toString()),
      onCatch: this.catchCb && packSignedClosure(this.catchCb.toString()),
      onFinally: this.finallyCb && packSignedClosure(this.finallyCb.toString()),
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
  if (!source)
    return
  // Signed at dispatch; the store is not a trust boundary. See closure-signing.ts.
  const verified = unpackSignedClosure(source)
  const fn = new Function(`return (${verified})`)() as BatchCallback
  await fn(batch, error)
}

/** Has this batch been cancelled (so remaining jobs should be skipped)? */
export async function isBatchCancelled(id: string): Promise<boolean> {
  if (!adapter)
    return false
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
  if (!adapter)
    return
  const record = await adapter.recordJobResult(id, success)
  if (!record)
    return
  const batch = new Batch(record)

  // First failure with allowFailures off → cancel the batch and run catch.
  // `cancel()` reporting that IT performed the transition is the gate, rather
  // than a `failed === 1` test on an already-read record: concurrent failures
  // all read a count past 1, so that test was false for every one of them and
  // the batch was never cancelled.
  if (!success && !record.allowFailures && record.cancelledAt == null) {
    if (await adapter.cancel(id))
      await runCallback(record.onCatch, batch, error)
  }

  // All jobs accounted for → run then (if clean) + finally, exactly once.
  if (record.pending <= 0 && record.finishedAt == null) {
    if (await adapter.markFinished(id)) {
      // A cancelled batch never counts as "all succeeded", even when nothing
      // actually failed (an explicit `batch.cancel()` leaves `failed` at 0).
      if (record.failed === 0 && record.cancelledAt == null)
        await runCallback(record.onThen, batch)
      await runCallback(record.onFinally, batch)
    }
  }
}
