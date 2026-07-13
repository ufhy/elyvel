import type { FailedJobRepository } from './failed'
import { reconstructJob } from './job'
import type { QueueStore } from './store'

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

    const { job: name, data, tries } = JSON.parse(record.body) as {
      job: string
      data: Record<string, unknown>
      tries: number
    }
    const job = reconstructJob(name, data, tries)
    try {
      await job.handle()
    } catch (error) {
      const willRetry = record.attempts < (job.tries ?? 1)
      this.options.onError?.(name, error, willRetry)
      if (willRetry) {
        await this.store.release(record, this.options.retryAfter ?? 0)
      } else {
        await job.failed?.(error)
        const connection = this.options.connection ?? 'default'
        await this.options.failed?.log(connection, connection, record.body, error)
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
