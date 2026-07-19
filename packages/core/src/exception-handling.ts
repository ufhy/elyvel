import { RateLimiter, rateLimiter } from './throttle'

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
const THROTTLE_WINDOW_SECONDS = 60

function throttleKey(error: unknown): string {
  const ctor = error instanceof Error ? error.constructor.name : typeof error
  const message = error instanceof Error ? error.message : String(error)
  return `exception-throttle:${ctor}:${message}`
}

/**
 * Whether `error` should be logged, applying the configured
 * dontReport/throttle/dedup rules. The throttle counter is backed by
 * `@elyvel/core`'s `RateLimiter` facade (the same one HTTP throttling uses),
 * so it's cross-process-safe wherever an app has already configured
 * `configureRateLimiterStore` with a shared store (e.g. `RedisRateLimiterStore`).
 */
export async function shouldReportError(error: unknown): Promise<boolean> {
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
      const count = await RateLimiter.hit(throttleKey(error), THROTTLE_WINDOW_SECONDS)
      if (count > perMinute)
        return false
    }
  }

  if (config.dontReportDuplicates && isObject)
    reportedInstances.add(error)
  return true
}

/** Test-only: clear throttle state and the active config between test cases. */
export function resetExceptionHandling(): void {
  config = {}
  rateLimiter.clear()
}
