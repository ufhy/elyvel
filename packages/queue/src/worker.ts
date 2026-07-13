import type { FailedJobRepository } from './failed'
import { backoffFor, reconstructJob, type SerializedJob } from './job'
import type { QueueStore } from './store'
import { uniqueKeyFor, uniqueLock } from './unique'

export interface WorkerOptions {
  /** Seconds to wait before a failed job is retried. Default 0. */
  retryAfter?: number
  /** Called when a job throws (each attempt). */
  onError?: (name: string, error: unknown, willRetry: boolean) => void
  /** Connection name recorded on failed jobs. Default 'default'. */
  connection?: string
  /** Where to persist jobs whose retries are exhausted (from `failedJobs()`). */
  failed?: FailedJobRepository | null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Reject if `promise` doesn't settle within `seconds`. Note: JS can't forcibly
 * cancel the underlying work, so `handle()` keeps running — but the job is
 * treated as failed and retried/failed accordingly.
 */
function withTimeout<T>(promise: Promise<T>, seconds: number | undefined): Promise<T> {
  if (!seconds) return promise
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Job timed out after ${seconds}s`)), seconds * 1000)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>
}

/** Pulls jobs off a {@link QueueStore} and runs them, with retries. */
export class Worker {
  constructor(
    private readonly store: QueueStore,
    private readonly options: WorkerOptions = {},
  ) {}

  /** Process the next ready job. Returns true if one was processed. */
  async processNext(): Promise<boolean> {
    const record = await this.store.pop()
    if (!record) return false

    const serialized = JSON.parse(record.body) as SerializedJob
    const job = reconstructJob(serialized)
    const name = serialized.job
    const willReleaseLock = async () => {
      const key = uniqueKeyFor(job)
      if (key) await uniqueLock()?.release(key)
    }
    try {
      await withTimeout(Promise.resolve(job.handle()), job.timeout)
      await willReleaseLock()
    } catch (error) {
      // Cap attempts by tries and (if set) maxExceptions — in our model every
      // failure is an exception, so the lower of the two wins.
      const cap = Math.min(job.tries ?? 1, job.maxExceptions ?? Number.POSITIVE_INFINITY)
      const willRetry = record.attempts < cap
      this.options.onError?.(name, error, willRetry)
      if (willRetry) {
        await this.store.release(record, backoffFor(job, record.attempts, this.options.retryAfter ?? 0))
      } else {
        await job.failed?.(error)
        const connection = this.options.connection ?? 'default'
        await this.options.failed?.log(connection, connection, record.body, error)
        await willReleaseLock() // released on final failure, held across retries
      }
    }
    return true
  }

  /**
   * Work the queue. `once` processes a single job; `stopWhenEmpty` drains then
   * returns (great for tests/CI); otherwise it polls forever every `sleepMs`.
   * Returns the number of jobs processed.
   */
  async work(opts: { once?: boolean; stopWhenEmpty?: boolean; sleepMs?: number; max?: number } = {}): Promise<number> {
    let processed = 0
    while (true) {
      const did = await this.processNext()
      if (did) {
        processed++
        if (opts.once || (opts.max && processed >= opts.max)) break
        continue
      }
      if (opts.once || opts.stopWhenEmpty) break
      await sleep(opts.sleepMs ?? 1000)
    }
    return processed
  }
}
