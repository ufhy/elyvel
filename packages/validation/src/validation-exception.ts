import { HttpException, trans } from '@elyvel/support'

export type ErrorBag = Record<string, string[]>

/**
 * Thrown when validation fails. Carries the Laravel-style error bag and a 422
 * status so the framework's error handler can render it as JSON — this
 * exception's own `.message` (built by {@link summarize}) is what actually
 * reaches the client (see core's `error-pages.ts` `jsonBody()`/`safeMessage()`),
 * not just an internal/log-only string, so it's translated too.
 */
export class ValidationException extends HttpException {
  readonly isValidationException = true
  /** Narrows {@link HttpException.errors}; `declare` re-types without re-declaring the field. */
  declare readonly errors: ErrorBag

  constructor(errors: ErrorBag) {
    super(422, summarize(errors), errors)
    this.name = 'ValidationException'
  }
}

function summarize(errors: ErrorBag): string {
  const all = Object.values(errors).flat()
  const first = all[0] ?? trans('validation::exception.invalid', {}, 'The given data was invalid.')
  if (all.length <= 1)
    return first
  const more = all.length - 1
  const suffix = more === 1
    ? trans('validation::exception.and_one_more', {}, 'and 1 more error')
    : trans('validation::exception.and_more', { count: more }, `and ${more} more errors`)
  return `${first} (${suffix})`
}
