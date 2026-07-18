/**
 * App-timezone-aware date handling. Times are always *stored* in UTC (the ORM
 * does this); a timezone only affects how you *display* or *bucket* them —
 * "store UTC, convert on display".
 *
 * The default timezone is set at boot from `config('app.timezone')`. Per request
 * you can narrow it (e.g. to the signed-in user's zone) via {@link setRequestTimezone}
 * / {@link runWithTimezone} — resolved concurrency-safely with AsyncLocalStorage,
 * so parallel requests never see each other's zone.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

let appTimezone = 'UTC'

// Per-request timezone override; falls back to the global app timezone.
const tzStore = new AsyncLocalStorage<string>()

/** Set the process-wide default timezone (called at boot from config). */
export function setAppTimezone(timezone: string): void {
  appTimezone = timezone
}

/** The process-wide default timezone. */
export function getAppTimezone(): string {
  return appTimezone
}

/** The timezone in effect right now: the request scope's, else the app default. */
export function currentTimezone(): string {
  return tzStore.getStore() ?? appTimezone
}

/** Set the timezone for the rest of the current async scope (e.g. a request). */
export function setRequestTimezone(timezone: string): void {
  tzStore.enterWith(timezone)
}

/** Run `fn` with `timezone` active for its entire async continuation. */
export function runWithTimezone<T>(timezone: string, fn: () => T): T {
  return tzStore.run(timezone, fn)
}

type DateInput = Date | string | number

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value)
}

/**
 * Format an instant in the current timezone (or an override), via `Intl`.
 *
 * @example
 * formatDate(user.created_at, { dateStyle: 'medium', timeStyle: 'short' }, 'id-ID')
 */
export function formatDate(
  value: DateInput,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
  locale?: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: options.timeZone ?? currentTimezone(),
    ...options,
  }).format(toDate(value))
}

/** The date/time parts of an instant in the given timezone (default: current). */
export function dateParts(
  value: DateInput,
  timezone: string = currentTimezone(),
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
  for (const p of parts) {
    if (p.type !== 'literal')
      out[p.type] = p.value
  }
  return out
}

/**
 * The UTC offset (in minutes) of `timezone` at a given instant — DST-correct
 * because it's evaluated at that instant. Positive means ahead of UTC (e.g.
 * Asia/Makassar → 480).
 */
export function timezoneOffset(timezone: string, at: Date = new Date()): number {
  const p = dateParts(at, timezone)
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour === '24' ? '0' : p.hour),
    Number(p.minute),
    Number(p.second),
  )
  return Math.round((asUtc - at.getTime()) / 60000)
}

/**
 * The UTC instant of local midnight for `dateStr` (`YYYY-MM-DD`) in `timezone`.
 * DST-correct: the offset is resolved for that specific local day.
 */
export function zonedStartOfDayUtc(dateStr: string, timezone: string = currentTimezone()): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  // First guess: treat the wall-clock midnight as if it were UTC…
  const guess = Date.UTC(y!, m! - 1, d!, 0, 0, 0)
  // …then correct by the zone's offset at that instant.
  const offsetMin = timezoneOffset(timezone, new Date(guess))
  return new Date(guess - offsetMin * 60000)
}
