export type ErrorBag = Record<string, string[]>

/**
 * Thrown when validation fails. Carries the Laravel-style error bag and a 422
 * status so the framework's error handler can render it as JSON.
 */
export class ValidationException extends Error {
  readonly status = 422
  readonly isValidationException = true
  readonly errors: ErrorBag

  constructor(errors: ErrorBag) {
    super(summarize(errors))
    this.name = 'ValidationException'
    this.errors = errors
  }
}

function summarize(errors: ErrorBag): string {
  const all = Object.values(errors).flat()
  const first = all[0] ?? 'The given data was invalid.'
  if (all.length <= 1) return first
  const more = all.length - 1
  return `${first} (and ${more} more ${more === 1 ? 'error' : 'errors'})`
}
