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
  /** Distinguishes unique instances (e.g. a model id). Defaults to ''. */
  uniqueId?(): string

  abstract handle(): void | Promise<void>
  failed?(error: unknown): void | Promise<void>
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
}

export interface SerializedJob {
  job: string
  data: Record<string, unknown>
  config: JobConfig
}

/** Fields that are job configuration, not user payload. */
const CONFIG_KEYS = new Set(['tries', 'backoff', 'timeout', 'maxExceptions', 'unique', 'uniqueFor'])

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
  const config: JobConfig = { tries: job.tries }
  if (job.backoff !== undefined) config.backoff = job.backoff
  if (job.timeout !== undefined) config.timeout = job.timeout
  if (job.maxExceptions !== undefined) config.maxExceptions = job.maxExceptions
  if (job.unique !== undefined) config.unique = job.unique
  if (job.uniqueFor !== undefined) config.uniqueFor = job.uniqueFor
  return { job: job.constructor.name, data, config }
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
  return job
}

/** The delay (seconds) before the next retry, given how many attempts have run. */
export function backoffFor(job: Job, attempts: number, fallback = 0): number {
  const backoff = job.backoff
  if (backoff === undefined) return fallback
  if (typeof backoff === 'number') return backoff
  if (backoff.length === 0) return fallback
  // attempts is 1-based (the attempt that just ran); pick this attempt's delay.
  return backoff[Math.min(attempts - 1, backoff.length - 1)] ?? fallback
}
