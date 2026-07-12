/**
 * App-timezone-aware date formatting. Times are always *stored* in UTC (the
 * ORM does this); the app timezone only affects how you *display* them —
 * mirroring the "store UTC, convert on display" best practice.
 *
 * The default timezone is set at boot from `config('app.timezone')`.
 */
let appTimezone = 'UTC'

export function setAppTimezone(timezone: string): void {
  appTimezone = timezone
}

export function getAppTimezone(): string {
  return appTimezone
}

type DateInput = Date | string | number

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value)
}

/**
 * Format an instant in the app timezone (or an override), via `Intl`.
 *
 * @example
 * formatDate(user.created_at, { dateStyle: 'medium', timeStyle: 'short' }, 'id-ID')
 */
export function formatDate(
  value: DateInput,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
  locale?: string,
): string {
  return new Intl.DateTimeFormat(locale, { timeZone: options.timeZone ?? appTimezone, ...options }).format(
    toDate(value),
  )
}

/** The date/time parts of an instant in the app timezone (or an override). */
export function dateParts(
  value: DateInput,
  timezone: string = appTimezone,
): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(toDate(value))
  const out: Record<string, string> = {}
  for (const p of parts) if (p.type !== 'literal') out[p.type] = p.value
  return out
}
