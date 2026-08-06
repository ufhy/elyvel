/**
 * Running independent tasks at the same time — Laravel's `Concurrency` facade.
 *
 * Laravel needs child processes for this because PHP is synchronous. Bun does
 * not: an async closure already runs concurrently on the event loop, so there is
 * no process driver here and nothing is serialised. What this adds over a bare
 * `Promise.all` is the part people re-write badly at every call site:
 *
 * - **Named results** — `run({ users: …, orders: … })` returns `{ users, orders }`.
 * - **A limit** — fifty tasks against a database with ten connections, six at a
 *   time, without hand-rolling a worker pool.
 * - **A timeout per task**, without a `Promise.race` that leaks the loser.
 *
 * One task failing rejects the whole `run` (as `Promise.all` and Laravel both
 * do) — but only after every started task has settled, so nothing is left
 * running behind the caller's back.
 */

export class ConcurrencyTimedOutError extends Error {
  constructor(label: string | number, seconds: number) {
    super(`Concurrent task ${typeof label === 'number' ? `#${label}` : `"${label}"`} timed out after ${seconds}s.`)
    this.name = 'ConcurrencyTimedOutError'
  }
}

export interface ConcurrencyOptions {
  /** Run at most this many tasks at once. Default: all of them. */
  limit?: number
  /** Reject a task that takes longer than this. Default: no timeout. */
  timeoutSeconds?: number
}

type Task<T> = () => T | Promise<T>

export async function runConcurrently<T>(tasks: Task<T>[], options?: ConcurrencyOptions): Promise<T[]>
export async function runConcurrently<T extends Record<string, Task<unknown>>>(
  tasks: T,
  options?: ConcurrencyOptions,
): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }>
export async function runConcurrently(
  tasks: Task<unknown>[] | Record<string, Task<unknown>>,
  options: ConcurrencyOptions = {},
): Promise<unknown> {
  const named = !Array.isArray(tasks)
  const entries: [string | number, Task<unknown>][] = named
    ? Object.entries(tasks)
    : tasks.map((task, index) => [index, task])

  const limit = Math.max(1, options.limit ?? entries.length)
  const results = Array.from({ length: entries.length })
  const errors: unknown[] = []
  let cursor = 0

  // `limit` workers pull from one shared cursor. Every task settles — even
  // after a failure — so a caller never has work still running after the
  // returned promise rejected. Failures are collected, not raced.
  const worker = async (): Promise<void> => {
    while (cursor < entries.length) {
      const index = cursor++
      const [label, task] = entries[index] as [string | number, Task<unknown>]
      try {
        results[index] = await withTimeout(task, label, options.timeoutSeconds)
      }
      catch (error) {
        errors.push(error)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, entries.length) }, () => worker()))

  if (errors.length > 0)
    throw errors[0]

  if (!named)
    return results
  const out: Record<string, unknown> = {}
  entries.forEach(([label], index) => {
    out[label as string] = results[index]
  })
  return out
}

async function withTimeout(task: Task<unknown>, label: string | number, seconds?: number): Promise<unknown> {
  if (seconds === undefined)
    return task()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve(task()),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new ConcurrencyTimedOutError(label, seconds)), seconds * 1000)
      }),
    ])
  }
  finally {
    // Without this, the losing timer keeps the event loop alive until it fires —
    // the classic Promise.race leak.
    if (timer)
      clearTimeout(timer)
  }
}

/** The `Concurrency` namespace, mirroring Laravel's facade. */
export const Concurrency = {
  run: runConcurrently,
}
