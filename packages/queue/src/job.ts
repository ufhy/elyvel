import { decryptString, encryptString, isEncrypted } from './encryption'
import { dehydrateData } from './serializes-models'

/**
 * A queued job. Put your work in `handle()`; store data in public fields (they
 * are serialized to the queue and restored on the worker). Optionally implement
 * `failed()` for when retries are exhausted.
 */
export abstract class Job {
  /** Max attempts before the job is marked failed. Default 1. */
  tries = 1
  /**
   * Seconds to wait before retrying. A number is a fixed delay; an array gives
   * a per-attempt schedule (e.g. `[1, 5, 10]` — exponential-ish backoff), using
   * the last entry once exhausted.
   */
  backoff?: number | number[]
  /** Max seconds `handle()` may run before it's treated as failed. */
  timeout?: number
  /** Fail after this many thrown exceptions, even if `tries` remains. */
  maxExceptions?: number
  /** Only allow one instance of this job (per {@link uniqueId}) to be queued at a time. */
  unique?: boolean
  /** How long (seconds) the uniqueness lock is held. Default 3600. */
  uniqueFor?: number
  /** Encrypt this job's payload at rest (needs configureJobEncryption). */
  encrypt?: boolean
  /** The batch this job belongs to (set by Bus.batch); tracked by the worker. */
  batchId?: string
  /** Distinguishes unique instances (e.g. a model id). Defaults to ''. */
  uniqueId?(): string

  /** Jobs to dispatch, in order, after this one succeeds (set via {@link chain}). */
  chainedJobs?: Job[]

  abstract handle(): void | Promise<void>
  failed?(error: unknown): void | Promise<void>
  /** Middleware wrapping `handle()` (e.g. WithoutOverlapping, RateLimited). */
  // biome-ignore lint/suspicious/noExplicitAny: avoids a circular import with middleware.ts
  middleware?(): any[]

  /** Queue these jobs to run in sequence after this one completes successfully. */
  chain(jobs: Job[]): this {
    this.chainedJobs = jobs
    return this
  }
}

// biome-ignore lint/suspicious/noExplicitAny: job classes have varied shapes
export type JobClass = new (...args: any[]) => Job

/** Runtime config carried with a serialized job (not part of its payload). */
export interface JobConfig {
  tries: number
  backoff?: number | number[]
  timeout?: number
  maxExceptions?: number
  unique?: boolean
  uniqueFor?: number
  encrypt?: boolean
  batchId?: string
}

export interface SerializedJob {
  job: string
  data: Record<string, unknown>
  config: JobConfig
  /** Remaining jobs to dispatch after this one succeeds. */
  chain?: SerializedJob[]
}

/** Fields that are job configuration/plumbing, not user payload. */
const CONFIG_KEYS = new Set([
  'tries',
  'backoff',
  'timeout',
  'maxExceptions',
  'unique',
  'uniqueFor',
  'encrypt',
  'batchId',
  'chainedJobs',
])

const registry = new Map<string, JobClass>()

/** Register a job class so the worker can reconstruct it from the queue. */
export function registerJob(...classes: JobClass[]): void {
  for (const cls of classes) registry.set(cls.name, cls)
}

/** Serialize a job to `{ job, data, config }` (payload fields + retry config). */
export function serializeJob(job: Job): SerializedJob {
  const data: Record<string, unknown> = {}
  for (const key of Object.keys(job)) {
    if (CONFIG_KEYS.has(key)) continue
    data[key] = (job as unknown as Record<string, unknown>)[key]
  }
  const serializedData = dehydrateData(data)
  const config: JobConfig = { tries: job.tries }
  if (job.backoff !== undefined) config.backoff = job.backoff
  if (job.timeout !== undefined) config.timeout = job.timeout
  if (job.maxExceptions !== undefined) config.maxExceptions = job.maxExceptions
  if (job.unique !== undefined) config.unique = job.unique
  if (job.uniqueFor !== undefined) config.uniqueFor = job.uniqueFor
  if (job.encrypt !== undefined) config.encrypt = job.encrypt
  if (job.batchId !== undefined) config.batchId = job.batchId
  const result: SerializedJob = { job: job.constructor.name, data: serializedData, config }
  if (job.chainedJobs && job.chainedJobs.length > 0) result.chain = job.chainedJobs.map(serializeJob)
  return result
}

/** Reconstruct a job instance (with its prototype/methods) from serialized data. */
export function reconstructJob(serialized: SerializedJob): Job {
  const cls = registry.get(serialized.job)
  if (!cls) {
    throw new Error(`[elysia-ravel] Unknown job "${serialized.job}". Register it with registerJob(${serialized.job}).`)
  }
  const job = Object.create(cls.prototype) as Job
  Object.assign(job, serialized.data)
  job.tries = serialized.config.tries
  job.backoff = serialized.config.backoff
  job.timeout = serialized.config.timeout
  job.maxExceptions = serialized.config.maxExceptions
  job.unique = serialized.config.unique
  job.uniqueFor = serialized.config.uniqueFor
  job.encrypt = serialized.config.encrypt
  job.batchId = serialized.config.batchId
  return job
}

/** Serialize a job to a store-ready string body (encrypting if `config.encrypt`). */
export function encodeBody(serialized: SerializedJob): string {
  const json = JSON.stringify(serialized)
  return serialized.config.encrypt ? encryptString(json) : json
}

/** Parse a store body back to a {@link SerializedJob} (decrypting if needed). */
export function decodeBody(body: string): SerializedJob {
  return JSON.parse(isEncrypted(body) ? decryptString(body) : body) as SerializedJob
}

/**
 * Wraps a plain closure so it can be queued (Laravel's queued closures).
 * The function is serialized via `toString()`, so it must be self-contained —
 * variables captured from the enclosing scope are NOT preserved.
 */
export class CallQueuedClosure extends Job {
  constructor(public source = '') {
    super()
  }
  handle(): void | Promise<void> {
    // biome-ignore lint/security/noGlobalEval: developer-authored closure, same trust as their own code
    const fn = new Function(`return (${this.source})`)() as () => void | Promise<void>
    return fn()
  }
}
registerJob(CallQueuedClosure)

/** The delay (seconds) before the next retry, given how many attempts have run. */
export function backoffFor(job: Job, attempts: number, fallback = 0): number {
  const backoff = job.backoff
  if (backoff === undefined) return fallback
  if (typeof backoff === 'number') return backoff
  if (backoff.length === 0) return fallback
  // attempts is 1-based (the attempt that just ran); pick this attempt's delay.
  return backoff[Math.min(attempts - 1, backoff.length - 1)] ?? fallback
}
