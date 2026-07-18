/**
 * The framework's date object — a configured dayjs (elyvel's Carbon). All
 * model date/datetime/timestamp attributes are cast to this, so every date has a
 * rich, chainable, timezone-aware API: `user.created_at.format('DD/MM/YYYY')`,
 * `.add(3, 'day')`, `.fromNow()`, `.tz('Asia/Makassar')`.
 *
 * dayjs is small; its plugins ship inside the package and are activated once here
 * (no per-plugin installs). Times are stored UTC (ISO with `Z`); the zone only
 * affects display and is taken from the active request timezone by default.
 */
import dayjs from 'dayjs'
import advancedFormat from 'dayjs/plugin/advancedFormat'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import relativeTime from 'dayjs/plugin/relativeTime'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { currentTimezone } from './datetime'

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(relativeTime)
dayjs.extend(customParseFormat)
dayjs.extend(localizedFormat)
dayjs.extend(advancedFormat)

export type { Dayjs } from 'dayjs'
/** The configured dayjs factory (plugins already applied). */
export { dayjs }

export type DateInput = Date | string | number | dayjs.Dayjs | null | undefined

/**
 * Wrap any date-like value as a framework date, displayed in `tz` (default: the
 * active request timezone). No argument → now. Laravel's `Carbon::parse` / `now`.
 */
export function date(input?: DateInput, tz: string = currentTimezone()): dayjs.Dayjs {
  const d = input === undefined || input === null ? dayjs() : dayjs(input)
  return d.tz(tz)
}

/** The current moment, in `tz` (default: the active request timezone). */
export function now(tz: string = currentTimezone()): dayjs.Dayjs {
  return date(undefined, tz)
}

/** Today's calendar date (`YYYY-MM-DD`) in `tz` (default: active request timezone). */
export function today(tz: string = currentTimezone()): string {
  return now(tz).format('YYYY-MM-DD')
}

/** Whether `value` is a framework date (dayjs) instance. */
export function isDate(value: unknown): value is dayjs.Dayjs {
  return dayjs.isDayjs(value)
}
