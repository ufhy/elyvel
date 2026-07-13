/**
 * A queued job. Put your work in `handle()`; store data in public fields (they
 * are serialized to the queue and restored on the worker). Optionally implement
 * `failed()` for when retries are exhausted.
 */
export abstract class Job {
  /** Max attempts before the job is marked failed. Default 1. */
  tries = 1
  abstract handle(): void | Promise<void>
  failed?(error: unknown): void | Promise<void>
}

// biome-ignore lint/suspicious/noExplicitAny: job classes have varied shapes
export type JobClass = new (...args: any[]) => Job

const registry = new Map<string, JobClass>()

/** Register a job class so the worker can reconstruct it from the queue. */
export function registerJob(...classes: JobClass[]): void {
  for (const cls of classes) registry.set(cls.name, cls)
}

/** Serialize a job to `{ job, data }` (its own enumerable fields). */
export function serializeJob(job: Job): { job: string; data: Record<string, unknown>; tries: number } {
  const data: Record<string, unknown> = {}
  for (const key of Object.keys(job)) {
    if (key === 'tries') continue
    data[key] = (job as unknown as Record<string, unknown>)[key]
  }
  return { job: job.constructor.name, data, tries: job.tries }
}

/** Reconstruct a job instance (with its prototype/methods) from serialized data. */
export function reconstructJob(name: string, data: Record<string, unknown>, tries: number): Job {
  const cls = registry.get(name)
  if (!cls) {
    throw new Error(`[elysia-ravel] Unknown job "${name}". Register it with registerJob(${name}).`)
  }
  const job = Object.create(cls.prototype) as Job
  Object.assign(job, data)
  job.tries = tries
  return job
}
