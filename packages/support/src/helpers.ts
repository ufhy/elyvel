import { Arr } from './arr'

/**
 * Free-function helpers mirroring Laravel's global helpers. Named exports (not
 * globals) so imports stay explicit: `import { tap, retry, blank } from '@elyvel/support'`.
 */

/** Run `callback` with `value`, then return `value` — for fluent side-effects (Laravel's `tap`). */
export function tap<T>(value: T, callback: (value: T) => void): T {
  callback(value)
  return value
}

/** Resolve a value that may be a `() => value` thunk (Laravel's `value`). */
export function value<T>(source: T | (() => T)): T {
  return typeof source === 'function' ? (source as () => T)() : source
}

/** "Blank" à la Laravel: null/undefined, empty/whitespace string, empty array, or empty object. */
export function blank(value: unknown): boolean {
  if (value === null || value === undefined)
    return true
  if (typeof value === 'string')
    return value.trim() === ''
  if (Array.isArray(value))
    return value.length === 0
  if (value instanceof Map || value instanceof Set)
    return value.size === 0
  if (typeof value === 'object')
    return Object.keys(value).length === 0
  return false
}

/** The inverse of {@link blank}. Note: `0`, `false`, and `'0'` are filled. */
export function filled(value: unknown): boolean {
  return !blank(value)
}

/** Read a nested value from an object/array by dot-path (Laravel's `data_get`). */
export function dataGet<T = unknown>(target: unknown, path: string | null, fallback?: T): T | undefined {
  const result = Arr.get<T>(target, path)
  return result === undefined ? fallback : result
}

/**
 * Retry `callback` up to `times` attempts, sleeping `sleepMs` between tries
 * (Laravel's `retry`). Rethrows the last error if all attempts fail. `when`, if
 * given, gates whether a given error is retryable.
 */
export async function retry<T>(
  times: number,
  callback: (attempt: number) => Promise<T> | T,
  sleepMs = 0,
  when?: (error: unknown) => boolean,
): Promise<T> {
  let attempt = 1
  for (;;) {
    try {
      return await callback(attempt)
    }
    catch (error) {
      if (attempt >= times || (when && !when(error)))
        throw error
      attempt++
      if (sleepMs > 0)
        await new Promise(resolve => setTimeout(resolve, sleepMs))
    }
  }
}
