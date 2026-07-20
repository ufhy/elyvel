import type { MiddlewareContext } from './middleware'
import { Middleware } from './middleware'

/** Fields never touched, regardless of nesting depth (matches Laravel's default `$except`). */
const DEFAULT_EXCEPT = new Set(['password', 'password_confirmation', 'current_password'])

/** Recursively transform every string in `value`, skipping keys in `except`. */
function walk(value: unknown, except: Set<string>, transform: (s: string) => string | null): unknown {
  if (typeof value === 'string')
    return transform(value)
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = walk(value[i], except, transform)
    return value
  }
  if (value !== null && typeof value === 'object' && value.constructor === Object) {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (except.has(key))
        continue
      (value as Record<string, unknown>)[key] = walk((value as Record<string, unknown>)[key], except, transform)
    }
    return value
  }
  // Anything else (File/Blob from multipart, Date, etc.) is left alone.
  return value
}

function applyToBody(context: MiddlewareContext, except: Set<string>, transform: (s: string) => string | null): void {
  walk(context.body, except, transform)
}

function applyToQuery(context: MiddlewareContext, except: Set<string>, transform: (s: string) => string): void {
  for (const key of Object.keys(context.query)) {
    if (except.has(key))
      continue
    const value = context.query[key]
    if (typeof value === 'string')
      context.query[key] = transform(value)
  }
}

/**
 * Trims every string in the request body/query (à la Laravel's `TrimStrings`).
 * Excludes `password`/`password_confirmation`/`current_password` at any nesting
 * depth by default — override {@link except} to change the list. Put this
 * before {@link ConvertEmptyStringsToNullMiddleware} in `global` so a
 * whitespace-only value becomes `''` before it's converted to `null`.
 */
export class TrimStringsMiddleware extends Middleware {
  protected except(): string[] {
    return [...DEFAULT_EXCEPT]
  }

  handle(context: MiddlewareContext): void {
    const except = new Set(this.except())
    applyToBody(context, except, s => s.trim())
    applyToQuery(context, except, s => s.trim())
  }
}

/**
 * Converts every empty-string value in the request body to `null` (à la
 * Laravel's `ConvertEmptyStringsToNull`). Purely a request-shaping concern —
 * it runs before your handler/FormRequest sees the data, so a blank form
 * field ends up `null` instead of `''` wherever that data is later inserted
 * or updated. Data written outside an HTTP request (queue jobs, console
 * commands, direct `table().insert()`) is unaffected, matching Laravel.
 */
export class ConvertEmptyStringsToNullMiddleware extends Middleware {
  protected except(): string[] {
    return [...DEFAULT_EXCEPT]
  }

  handle(context: MiddlewareContext): void {
    applyToBody(context, new Set(this.except()), s => (s === '' ? null : s))
  }
}
