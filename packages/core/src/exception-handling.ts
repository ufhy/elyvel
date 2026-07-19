/**
 * Controls over which uncaught (500) errors actually get logged — Laravel's
 * `bootstrap/app.php` → `withExceptions($exceptions)` (`dontReport`,
 * `dontReportWhen`, `throttle`, `dontReportDuplicates`). Only affects
 * logging — the client still gets the normal error response either way.
 */
export interface ExceptionHandlingConfig {
  /** Never log an instance of any of these classes. */
  dontReport?: Array<abstract new (...args: any[]) => Error>
  /** Never log when this returns true. */
  dontReportWhen?(error: unknown): boolean
  /**
   * Cap how often a given "kind" of error (constructor name + message) gets
   * logged, per rolling minute — so an incident storm doesn't flood the log.
   * Return the max allowed per minute, or `undefined` for no limit.
   */
  throttle?(error: unknown): number | undefined
  /** Never log the exact same error instance more than once. */
  dontReportDuplicates?: boolean
}

let config: ExceptionHandlingConfig = {}

/** Configure `dontReport`/`dontReportWhen`/`throttle`/`dontReportDuplicates` (usually in a service provider's `boot()`). */
export function configureExceptionHandling(cfg: ExceptionHandlingConfig): void {
  config = cfg
}

const reportedInstances = new WeakSet<object>()
const throttleBuckets = new Map<string, { count: number, windowStart: number }>()
const THROTTLE_WINDOW_MS = 60_000
/** Safety valve: dynamic (e.g. interpolated) messages could otherwise create unbounded buckets. */
const MAX_THROTTLE_BUCKETS = 5000

function throttleKey(error: unknown): string {
  const ctor = error instanceof Error ? error.constructor.name : typeof error
  const message = error instanceof Error ? error.message : String(error)
  return `${ctor}:${message}`
}

function pruneStaleThrottleBuckets(now: number): void {
  if (throttleBuckets.size < MAX_THROTTLE_BUCKETS)
    return
  for (const [key, bucket] of throttleBuckets) {
    if (now - bucket.windowStart >= THROTTLE_WINDOW_MS)
      throttleBuckets.delete(key)
  }
}

/** Whether `error` should be logged, applying the configured dontReport/throttle/dedup rules. */
export function shouldReportError(error: unknown): boolean {
  if (config.dontReportWhen?.(error))
    return false
  if (config.dontReport?.some(cls => error instanceof cls))
    return false

  const isObject = error !== null && typeof error === 'object'
  if (config.dontReportDuplicates && isObject && reportedInstances.has(error))
    return false

  if (config.throttle) {
    const perMinute = config.throttle(error)
    if (perMinute !== undefined) {
      const now = Date.now()
      pruneStaleThrottleBuckets(now)
      const key = throttleKey(error)
      const bucket = throttleBuckets.get(key)
      if (!bucket || now - bucket.windowStart >= THROTTLE_WINDOW_MS) {
        throttleBuckets.set(key, { count: 1, windowStart: now })
      }
      else {
        bucket.count++
        if (bucket.count > perMinute)
          return false
      }
    }
  }

  if (config.dontReportDuplicates && isObject)
    reportedInstances.add(error)
  return true
}

/** Test-only: clear throttle state and the active config between test cases. */
export function resetExceptionHandling(): void {
  config = {}
  throttleBuckets.clear()
}
