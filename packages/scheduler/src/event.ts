import { AsyncLocalStorage } from 'node:async_hooks'
import { cronMatches, partsInZone } from './cron'
import { scheduleMutex } from './mutex'

/** The unit of work a scheduled event runs. */
type Task = () => void | Promise<void>

/** Process-wide set of currently-running event names (for withoutOverlapping). */
const runningLocks = new Set<string>()

/** Distinguishes one lock acquisition from the next within this process. */
let overlapSequence = 0

/**
 * Output capture for `sendOutputTo`/`emailOutputTo`, scoped to the running
 * task's async context.
 *
 * This used to swap the four `console` methods on the GLOBAL console around an
 * `await`, which broke two ways. With two capturing tasks overlapping, B saved
 * A's tee as "the original", A's `finally` restored the real console, and then
 * B's `finally` restored A's tee — permanently corrupting `console` for the
 * whole process, appending every later log to a dead buffer. And even with one
 * task, any unrelated concurrent work in the same process (HTTP handlers under
 * `schedule:work`) had its output silently written into the task's output file
 * or emailed out.
 *
 * Patching once and routing through an AsyncLocalStorage lookup fixes both: a
 * write with no task context passes straight through, and nested/overlapping
 * tasks each see only their own buffer.
 */
const outputCapture = new AsyncLocalStorage<string[]>()
type ConsoleMethod = 'log' | 'info' | 'warn' | 'error'
const CAPTURED_METHODS: ConsoleMethod[] = ['log', 'info', 'warn', 'error']
let captureDepth = 0
let originalConsole: Pick<Console, ConsoleMethod> | null = null

function installOutputCapture(): void {
  if (originalConsole)
    return
  const original = { log: console.log, info: console.info, warn: console.warn, error: console.error }
  originalConsole = original
  for (const method of CAPTURED_METHODS) {
    const passthrough = original[method].bind(console) as (...a: unknown[]) => void
    console[method] = (...args: unknown[]) => {
      outputCapture
        .getStore()
        ?.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
      passthrough(...args)
    }
  }
}

function restoreOutputCapture(): void {
  // Only once the LAST capturing task is done, and always back to the real
  // console we saved on the way in — never to another task's tee.
  if (captureDepth > 0 || !originalConsole)
    return
  Object.assign(console, originalConsole)
  originalConsole = null
}

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

/**
 * Logs a task failure (wired to the app's real logger by `ScheduleServiceProvider`
 * — without this, a failing task's only trace was `console.error`, and the
 * documented cron setup (`schedule:run >> /dev/null 2>&1`) throws even that
 * away, so a `runInBackground()` task with no `.onFailure()` hook could fail
 * every run for weeks with zero record anywhere).
 */
type ScheduleFailureLogger = (event: ScheduledEvent, error: unknown) => void
let scheduleFailureLogger: ScheduleFailureLogger | null = null
export function configureScheduleFailureLogger(logger: ScheduleFailureLogger | null): void {
  scheduleFailureLogger = logger
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
    this.filters.push(date => this.withinWindow(date, start, end))
    return this
  }

  /** Skip when the time-of-day is within `[start, end]`. */
  unlessBetween(start: string, end: string): this {
    this.rejects.push(date => this.withinWindow(date, start, end))
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
    installOutputCapture()
    captureDepth++
    try {
      // Run the task inside its OWN async context so only ITS console output
      // lands in this buffer. (`.run()`, not `enterWith()` — on Bun,
      // `enterWith` after an internal await doesn't propagate to the caller.)
      await outputCapture.run(buffer, () => this.task())
    }
    finally {
      captureDepth--
      restoreOutputCapture()
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
    if (!this.isDue(date))
      return false
    if (this.envs && !this.envs.includes(schedulerEnvironment ?? ''))
      return false
    for (const filter of this.filters) {
      if (!(await filter(date)))
        return false
    }
    for (const reject of this.rejects) {
      if (await reject(date))
        return false
    }
    return true
  }

  /**
   * Run the task now, honoring withoutOverlapping/onOneServer and firing
   * lifecycle hooks. Returns false if skipped by a lock. Rethrows task errors
   * (after firing onFailure) so the caller can record them. `date` scopes the
   * onOneServer lock to the current due tick.
   */
  async run(date = new Date(0), options: { ignoreLocks?: boolean } = {}): Promise<boolean> {
    const mutex = scheduleMutex()
    const useLocks = !options.ignoreLocks

    // Both locks key off `this.name`, and an un-named event falls back to
    // `event(<expression>)` — so two unnamed `.everyMinute()` callbacks shared
    // ONE lock identity: with withoutOverlapping the second was skipped for as
    // long as the first ran, and with onOneServer only one of them ever ran per
    // tick while the other silently never did. Laravel guards this the same way.
    if (useLocks && (this.noOverlap || this.oneServer) && this.label == null) {
      throw new Error(
        `[elyvel] A scheduled event using withoutOverlapping()/onOneServer() `
        + `needs a name to lock on — "${this.expression}" has none, so it would `
        + `share its lock with every other unnamed event on the same schedule. `
        + `Add .named('some-unique-name').`,
      )
    }

    // onOneServer: first server to claim this tick wins; the lock is not
    // released (it must outlive the tick so peers skip it).
    if (useLocks && this.oneServer && mutex) {
      // Bucket by the event's own period, not always by the minute. A fixed
      // 60s bucket meant `.everyTenSeconds().onOneServer()` — due 6× a minute —
      // only ever claimed once per minute, silently dropping 5 of 6 runs.
      const period = this.repeatSeconds ?? 60
      const bucket = Math.floor(date.getTime() / (period * 1000))
      const claimed = await mutex.create(`oneserver:${this.name}:${bucket}`, period)
      if (!claimed)
        return false
    }

    // withoutOverlapping: cross-process via mutex, else per-process set.
    const overlapKey = `overlap:${this.name}`
    // Identifies THIS acquisition, so we only ever release our own lock — see
    // the release in `finally` below.
    const overlapToken = `${process.pid}:${++overlapSequence}`
    let heldOverlap = false
    if (useLocks && this.noOverlap) {
      if (mutex) {
        const acquired = await mutex.create(overlapKey, this.overlapTtl, overlapToken)
        if (!acquired)
          return false
      }
      else {
        if (runningLocks.has(this.name))
          return false
        runningLocks.add(this.name)
      }
      heldOverlap = true
    }

    for (const hook of this.beforeHooks) await hook()
    try {
      await this.runTask()
      for (const hook of this.successHooks) await hook()
      return true
    }
    catch (error) {
      scheduleFailureLogger?.(this, error)
      for (const hook of this.failureHooks) await hook(error)
      throw error
    }
    finally {
      for (const hook of this.afterHooks) await hook()
      if (heldOverlap) {
        // Release only OUR acquisition. Deleting unconditionally broke the
        // guarantee it exists for: a task outliving its TTL let a peer acquire
        // the freed key, and this `finally` then deleted the PEER's lock — so a
        // third process could start alongside the peer, which is exactly what
        // withoutOverlapping promises cannot happen.
        if (mutex)
          await mutex.forget(overlapKey, overlapToken)
        else runningLocks.delete(this.name)
      }
    }
  }

  private splitTime(time: string): [number, number] {
    const [h, m] = time.split(':')
    return [Number(h ?? 0), Number(m ?? 0)]
  }
}
