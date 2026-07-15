import { cronMatches, partsInZone } from './cron'
import { scheduleMutex } from './mutex'

/** The unit of work a scheduled event runs. */
type Task = () => void | Promise<void>

/** Process-wide set of currently-running event names (for withoutOverlapping). */
const runningLocks = new Set<string>()

/** The app environment scheduled events are compared against (set by the provider). */
let schedulerEnvironment: string | undefined
export function setSchedulerEnvironment(env: string): void {
  schedulerEnvironment = env
}

/** Optional mailer backing emailOutputTo (no mail package is bundled). */
type ScheduleMailer = (to: string, subject: string, body: string) => void | Promise<void>
let scheduleMailer: ScheduleMailer | null = null
export function configureScheduleMailer(mailer: ScheduleMailer): void {
  scheduleMailer = mailer
}

/** Minutes since midnight for `HH:MM`. */
function toMinutes(time: string): number {
  const [h, m] = time.split(':')
  return Number(h ?? 0) * 60 + Number(m ?? 0)
}

/**
 * A scheduled task with a fluent frequency + constraint API, mirroring
 * Laravel's `Illuminate\Console\Scheduling\Event`. Build the cron expression
 * with the frequency helpers, then narrow with `when`/`skip`/`timezone`.
 */
export class ScheduledEvent {
  /** Cron fields: minute hour day-of-month month day-of-week. */
  private segments: [string, string, string, string, string] = ['*', '*', '*', '*', '*']
  private tz: string | undefined
  private readonly filters: Array<(date: Date) => boolean | Promise<boolean>> = []
  private readonly rejects: Array<(date: Date) => boolean | Promise<boolean>> = []
  private noOverlap = false
  private overlapTtl = 3600 // seconds the overlap lock is held
  private oneServer = false
  private background = false
  private envs: string[] | undefined
  private repeatSeconds: number | undefined
  private outputPath: string | undefined
  private outputAppend = false
  private emailTo: string | undefined
  private label: string | undefined
  private readonly beforeHooks: Array<() => void | Promise<void>> = []
  private readonly afterHooks: Array<() => void | Promise<void>> = []
  private readonly successHooks: Array<() => void | Promise<void>> = []
  private readonly failureHooks: Array<(error: unknown) => void | Promise<void>> = []

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
  get runsInBackground(): boolean {
    return this.background
  }
  /** Sub-minute repeat interval in seconds, or undefined for minute-granular. */
  get repeatEverySeconds(): number | undefined {
    return this.repeatSeconds
  }

  // ── raw / naming ────────────────────────────────────────────────────────
  cron(expression: string): this {
    const parts = expression.trim().split(/\s+/)
    if (parts.length !== 5)
      throw new Error(`Cron expression must have 5 fields, got "${expression}"`)
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

  // ── sub-minute frequencies (only realized under `schedule:work`) ────────────
  everySecond(): this {
    this.repeatSeconds = 1
    return this
  }
  everyTwoSeconds(): this {
    this.repeatSeconds = 2
    return this
  }
  everyFiveSeconds(): this {
    this.repeatSeconds = 5
    return this
  }
  everyTenSeconds(): this {
    this.repeatSeconds = 10
    return this
  }
  everyFifteenSeconds(): this {
    this.repeatSeconds = 15
    return this
  }
  everyThirtySeconds(): this {
    this.repeatSeconds = 30
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
  /** Only run when the time-of-day is within `[start, end]` (handles overnight windows). */
  between(start: string, end: string): this {
    this.filters.push((date) => this.withinWindow(date, start, end))
    return this
  }
  /** Skip when the time-of-day is within `[start, end]`. */
  unlessBetween(start: string, end: string): this {
    this.rejects.push((date) => this.withinWindow(date, start, end))
    return this
  }
  /** Only run in these app environments (compared against setSchedulerEnvironment). */
  environments(...envs: string[]): this {
    this.envs = envs
    return this
  }
  /**
   * Prevent a second copy running while one is in flight. Per-process by
   * default; cross-process when a mutex is set via `configureScheduleMutex`.
   * `expiresAfterMinutes` bounds how long a crashed run holds the lock.
   */
  withoutOverlapping(expiresAfterMinutes = 60): this {
    this.noOverlap = true
    this.overlapTtl = expiresAfterMinutes * 60
    return this
  }
  /**
   * Run on only one server per due tick (needs a shared mutex via
   * `configureScheduleMutex`; a no-op without one).
   */
  onOneServer(): this {
    this.oneServer = true
    return this
  }
  /** Run the task without blocking the rest of the schedule (fire-and-forget). */
  runInBackground(): this {
    this.background = true
    return this
  }

  // ── lifecycle hooks ─────────────────────────────────────────────────────────
  /** Run before the task. */
  before(callback: () => void | Promise<void>): this {
    this.beforeHooks.push(callback)
    return this
  }
  /** Run after the task, whether it succeeded or failed. */
  after(callback: () => void | Promise<void>): this {
    this.afterHooks.push(callback)
    return this
  }
  /** Run after the task succeeds. */
  onSuccess(callback: () => void | Promise<void>): this {
    this.successHooks.push(callback)
    return this
  }
  /** Run when the task throws. */
  onFailure(callback: (error: unknown) => void | Promise<void>): this {
    this.failureHooks.push(callback)
    return this
  }

  // ── output & pings ──────────────────────────────────────────────────────────
  /** Capture the task's console output to a file (overwrite). */
  sendOutputTo(path: string): this {
    this.outputPath = path
    this.outputAppend = false
    return this
  }
  /** Capture the task's console output to a file (append). */
  appendOutputTo(path: string): this {
    this.outputPath = path
    this.outputAppend = true
    return this
  }
  /** Email the task's captured output (needs configureScheduleMailer). */
  emailOutputTo(address: string): this {
    this.emailTo = address
    return this
  }
  /** GET a URL before the task runs. */
  pingBefore(url: string): this {
    return this.before(() => void fetch(url).catch(() => {}))
  }
  /** GET a URL after the task runs. */
  thenPing(url: string): this {
    return this.after(() => void fetch(url).catch(() => {}))
  }
  /** GET a URL when the task succeeds. */
  pingOnSuccess(url: string): this {
    return this.onSuccess(() => void fetch(url).catch(() => {}))
  }
  /** GET a URL when the task fails. */
  pingOnFailure(url: string): this {
    return this.onFailure(() => void fetch(url).catch(() => {}))
  }

  /** Run the task, capturing console output to a file/email when configured. */
  private async runTask(): Promise<void> {
    if (!this.outputPath && !this.emailTo) {
      await this.task()
      return
    }
    const buffer: string[] = []
    const original = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
    }
    const tee =
      (fn: (...a: unknown[]) => void) =>
      (...args: unknown[]) => {
        buffer.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
        fn(...args)
      }
    console.log = tee(original.log)
    console.info = tee(original.info)
    console.warn = tee(original.warn)
    console.error = tee(original.error)
    try {
      await this.task()
    } finally {
      Object.assign(console, original)
      const output = buffer.join('\n')
      if (this.outputPath) {
        const existing = this.outputAppend
          ? await Bun.file(this.outputPath)
              .text()
              .catch(() => '')
          : ''
        await Bun.write(this.outputPath, existing + output + (output ? '\n' : ''))
      }
      if (this.emailTo && scheduleMailer) {
        await scheduleMailer(this.emailTo, `Scheduled task output: ${this.name}`, output)
      }
    }
  }

  private withinWindow(date: Date, start: string, end: string): boolean {
    const p = partsInZone(date, this.tz)
    const nowMin = p.hour * 60 + p.minute
    const s = toMinutes(start)
    const e = toMinutes(end)
    return s <= e ? nowMin >= s && nowMin <= e : nowMin >= s || nowMin <= e // overnight window
  }

  // ── evaluation ────────────────────────────────────────────────────────────
  /** Is the cron expression due at `date` (ignores when/skip filters)? */
  isDue(date: Date): boolean {
    return cronMatches(this.expression, date, this.tz)
  }

  /** Should this event run now — cron due, in-environment, AND all filters pass? */
  async shouldRun(date: Date): Promise<boolean> {
    if (!this.isDue(date)) return false
    if (this.envs && !this.envs.includes(schedulerEnvironment ?? '')) return false
    for (const filter of this.filters) if (!(await filter(date))) return false
    for (const reject of this.rejects) if (await reject(date)) return false
    return true
  }

  /**
   * Run the task now, honoring withoutOverlapping/onOneServer and firing
   * lifecycle hooks. Returns false if skipped by a lock. Rethrows task errors
   * (after firing onFailure) so the caller can record them. `date` scopes the
   * onOneServer lock to the current due tick.
   */
  async run(date = new Date(0)): Promise<boolean> {
    const mutex = scheduleMutex()

    // onOneServer: first server to claim this tick wins; the lock is not
    // released (it must outlive the tick so peers skip it).
    if (this.oneServer && mutex) {
      const bucket = Math.floor(date.getTime() / 60000)
      const claimed = await mutex.create(`oneserver:${this.name}:${bucket}`, 60)
      if (!claimed) return false
    }

    // withoutOverlapping: cross-process via mutex, else per-process set.
    const overlapKey = `overlap:${this.name}`
    if (this.noOverlap) {
      if (mutex) {
        const acquired = await mutex.create(overlapKey, this.overlapTtl)
        if (!acquired) return false
      } else {
        if (runningLocks.has(this.name)) return false
        runningLocks.add(this.name)
      }
    }

    for (const hook of this.beforeHooks) await hook()
    try {
      await this.runTask()
      for (const hook of this.successHooks) await hook()
      return true
    } catch (error) {
      for (const hook of this.failureHooks) await hook(error)
      throw error
    } finally {
      for (const hook of this.afterHooks) await hook()
      if (this.noOverlap) {
        if (mutex) await mutex.forget(overlapKey)
        else runningLocks.delete(this.name)
      }
    }
  }

  private splitTime(time: string): [number, number] {
    const [h, m] = time.split(':')
    return [Number(h ?? 0), Number(m ?? 0)]
  }
}
