/**
 * A tiny standard 5-field cron implementation: `minute hour day-of-month month
 * day-of-week`. Supports `*`, lists (`1,15`), ranges (`1-5`), and steps
 * (`1-30/2`, or `*` combined with `/5`). Day-of-week is 0-6 with 0 = Sunday
 * (7 also accepted).
 * No non-standard extensions (`?`, `L`, `#`) — Laravel's scheduler builds only
 * standard expressions, which is all we generate here.
 */

const FIELD_RANGES: [min: number, max: number][] = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week
]

/** Expand one cron field into the set of matching integers. */
export function parseCronField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>()
  for (const part of field.split(',')) {
    const [range, stepRaw] = part.split('/')
    const step = stepRaw ? Number(stepRaw) : 1
    if (!Number.isInteger(step) || step < 1)
      throw new Error(`Invalid cron step "${part}"`)

    let lo = min
    let hi = max
    if (range && range !== '*') {
      const [a, b] = range.split('-')
      lo = Number(a)
      hi = b !== undefined ? Number(b) : lo
      if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
        throw new Error(`Invalid cron field "${field}"`)
      }
    }
    for (let v = lo; v <= hi; v += step) values.add(v)
  }
  return values
}

interface ParsedCron {
  minute: Set<number>
  hour: Set<number>
  dayOfMonth: Set<number>
  month: Set<number>
  dayOfWeek: Set<number>
}

/** Parse a 5-field cron expression into matcher sets. */
export function parseCron(expression: string): ParsedCron {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5)
    throw new Error(`Cron expression must have 5 fields, got "${expression}"`)
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields.map((f, i) => {
    const [lo, hi] = FIELD_RANGES[i] as [number, number]
    // normalize Sunday-as-7 in the day-of-week field
    const normalized = i === 4 ? f.replace(/\b7\b/g, '0') : f
    return parseCronField(normalized, lo, hi)
  }) as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>]
  return { minute, hour, dayOfMonth, month, dayOfWeek }
}

/** Calendar parts of `date` in the given IANA timezone (default local). */
export function partsInZone(
  date: Date,
  timezone?: string,
): {
  minute: number
  hour: number
  dayOfMonth: number
  month: number
  dayOfWeek: number
} {
  if (!timezone) {
    return {
      minute: date.getMinutes(),
      hour: date.getHours(),
      dayOfMonth: date.getDate(),
      month: date.getMonth() + 1,
      dayOfWeek: date.getDay(),
    }
  }
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    minute: '2-digit',
    hour: '2-digit',
    day: '2-digit',
    month: '2-digit',
    weekday: 'short',
  })
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]))
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }
  return {
    minute: Number(parts.minute),
    hour: Number(parts.hour === '24' ? '0' : parts.hour), // some locales emit 24 for midnight
    dayOfMonth: Number(parts.day),
    month: Number(parts.month),
    dayOfWeek: weekdayMap[parts.weekday as string] ?? 0,
  }
}

/**
 * Whether `expression` is due at `date`. Following cron convention, when BOTH
 * day-of-month and day-of-week are restricted (not `*`), a match on EITHER
 * fires; otherwise both must match.
 */
export function cronMatches(expression: string, date: Date, timezone?: string): boolean {
  const cron = parseCron(expression)
  const p = partsInZone(date, timezone)
  if (!cron.minute.has(p.minute))
    return false
  if (!cron.hour.has(p.hour))
    return false
  if (!cron.month.has(p.month))
    return false

  const domRestricted = cron.dayOfMonth.size !== 31
  const dowRestricted = cron.dayOfWeek.size !== 7
  const domMatch = cron.dayOfMonth.has(p.dayOfMonth)
  const dowMatch = cron.dayOfWeek.has(p.dayOfWeek)
  if (domRestricted && dowRestricted)
    return domMatch || dowMatch
  return domMatch && dowMatch
}
