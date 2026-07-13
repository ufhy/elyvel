import { cronMatches } from './cron'

/** The unit of work a scheduled event runs. */
type Task = () => void | Promise<void>

/** Process-wide set of currently-running event names (for withoutOverlapping). */
const runningLocks = new Set<string>()

/**
 * A scheduled task with a fluent frequency + constraint API, mirroring
 * Laravel's `Illuminate\Console\Scheduling\Event`. Build the cron expression
 * with the frequency helpers, then narrow with `when`/`skip`/`timezone`.
 */
export class ScheduledEvent {
  /** Cron fields: minute hour day-of-month month day-of-week. */
  private segments: [string, string, string, string, string] = ['*', '*', '*', '*', '*']
  private tz: string | undefined
  private readonly filters: Array<() => boolean | Promise<boolean>> = []
  private readonly rejects: Array<() => boolean | Promise<boolean>> = []
  private noOverlap = false
  private label: string | undefined

  constructor(private readonly task: Task) {}

  get expression(): string {
    return this.segments.join(' ')
  }
  get timezoneName(): string | undefined {
    return this.tz
  }
  get name(): string {
    return this.label ?? `event(${this.expression})`
  }

  // ── raw / naming ────────────────────────────────────────────────────────
  cron(expression: string): this {
    const parts = expression.trim().split(/\s+/)
    if (parts.length !== 5) throw new Error(`Cron expression must have 5 fields, got "${expression}"`)
    this.segments = parts as [string, string, string, string, string]
    return this
  }
  named(label: string): this {
    this.label = label
    return this
  }
  timezone(tz: string): this {
    this.tz = tz
    return this
  }

  private set(index: 0 | 1 | 2 | 3 | 4, value: string): this {
    this.segments[index] = value
    return this
  }

  // ── frequencies ───────────────────────────────────────────────────────────
  everyMinute(): this {
    return this.set(0, '*')
  }
  everyTwoMinutes(): this {
    return this.set(0, '*/2')
  }
  everyFiveMinutes(): this {
    return this.set(0, '*/5')
  }
  everyTenMinutes(): this {
    return this.set(0, '*/10')
  }
  everyFifteenMinutes(): this {
    return this.set(0, '*/15')
  }
  everyThirtyMinutes(): this {
    return this.set(0, '*/30')
  }
  hourly(): this {
    return this.set(0, '0')
  }
  hourlyAt(minute: number): this {
    return this.set(0, String(minute))
  }
  daily(): this {
    return this.set(0, '0').set(1, '0')
  }
  /** Run once a day at `HH:MM`. */
  dailyAt(time: string): this {
    const [hour, minute] = this.splitTime(time)
    return this.set(0, String(minute)).set(1, String(hour))
  }
  twiceDaily(first = 1, second = 13): this {
    return this.set(0, '0').set(1, `${first},${second}`)
  }
  weekly(): this {
    return this.set(0, '0').set(1, '0').set(4, '0')
  }
  /** Run weekly on `day` (0=Sun…6=Sat) at `HH:MM`. */
  weeklyOn(day: number, time = '0:0'): this {
    const [hour, minute] = this.splitTime(time)
    return this.set(0, String(minute)).set(1, String(hour)).set(4, String(day))
  }
  monthly(): this {
    return this.set(0, '0').set(1, '0').set(2, '1')
  }
  monthlyOn(day = 1, time = '0:0'): this {
    const [hour, minute] = this.splitTime(time)
    return this.set(0, String(minute)).set(1, String(hour)).set(2, String(day))
  }
  quarterly(): this {
    return this.set(0, '0').set(1, '0').set(2, '1').set(3, '1,4,7,10')
  }
  yearly(): this {
    return this.set(0, '0').set(1, '0').set(2, '1').set(3, '1')
  }

  // ── day-of-week constraints ────────────────────────────────────────────────
  days(...days: number[]): this {
    return this.set(4, days.join(','))
  }
  weekdays(): this {
    return this.set(4, '1-5')
  }
  weekends(): this {
    return this.set(4, '0,6')
  }
  sundays(): this {
    return this.set(4, '0')
  }
  mondays(): this {
    return this.set(4, '1')
  }
  tuesdays(): this {
    return this.set(4, '2')
  }
  wednesdays(): this {
    return this.set(4, '3')
  }
  thursdays(): this {
    return this.set(4, '4')
  }
  fridays(): this {
    return this.set(4, '5')
  }
  saturdays(): this {
    return this.set(4, '6')
  }

  // ── constraints ─────────────────────────────────────────────────────────────
  /** Only run when the callback returns truthy. */
  when(callback: () => boolean | Promise<boolean>): this {
    this.filters.push(callback)
    return this
  }
  /** Skip when the callback returns truthy. */
  skip(callback: () => boolean | Promise<boolean>): this {
    this.rejects.push(callback)
    return this
  }
  /** Prevent a second copy running while one is in flight (per process). */
  withoutOverlapping(): this {
    this.noOverlap = true
    return this
  }

  // ── evaluation ────────────────────────────────────────────────────────────
  /** Is the cron expression due at `date` (ignores when/skip filters)? */
  isDue(date: Date): boolean {
    return cronMatches(this.expression, date, this.tz)
  }

  /** Should this event run now — cron due AND all filters pass? */
  async shouldRun(date: Date): Promise<boolean> {
    if (!this.isDue(date)) return false
    for (const filter of this.filters) if (!(await filter())) return false
    for (const reject of this.rejects) if (await reject()) return false
    return true
  }

  /** Run the task now, honoring withoutOverlapping. Returns false if skipped by a lock. */
  async run(): Promise<boolean> {
    if (this.noOverlap) {
      if (runningLocks.has(this.name)) return false
      runningLocks.add(this.name)
    }
    try {
      await this.task()
      return true
    } finally {
      if (this.noOverlap) runningLocks.delete(this.name)
    }
  }

  private splitTime(time: string): [number, number] {
    const [h, m] = time.split(':')
    return [Number(h ?? 0), Number(m ?? 0)]
  }
}
