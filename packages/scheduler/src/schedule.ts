import { ScheduledEvent } from './event'

/** Anything with a `handle()` — e.g. an `@elyvel/queue` Job. */
interface Runnable {
  handle(): void | Promise<void>
}

export interface ScheduleRunResult {
  name: string
  expression: string
  /** true = ran, false = due but skipped by a withoutOverlapping lock. */
  ran: boolean
  error?: unknown
}

/**
 * The task schedule — Laravel's `Illuminate\Console\Scheduling\Schedule`.
 * Register work with `call`/`job`/`command`/`exec`, chain a frequency on the
 * returned {@link ScheduledEvent}, then run due tasks with `run()` (invoked
 * every minute by `elyvel schedule:run` from system cron).
 */
export class Schedule {
  readonly events: ScheduledEvent[] = []
  /** Background runs started but not yet settled — see `drainBackground()`. */
  private readonly backgroundRuns: Promise<void>[] = []

  private add(event: ScheduledEvent): ScheduledEvent {
    this.events.push(event)
    return event
  }

  /** Schedule a callback. */
  call(task: () => void | Promise<void>): ScheduledEvent {
    return this.add(new ScheduledEvent(task))
  }

  /** Schedule a job — runs its `handle()` inline. To enqueue instead, use `call(() => dispatch(job))`. */
  job(job: Runnable): ScheduledEvent {
    return this.add(new ScheduledEvent(() => job.handle()).named(job.constructor.name))
  }

  /** Schedule a shell command. */
  exec(command: string): ScheduledEvent {
    return this.add(new ScheduledEvent(() => runShell(command)).named(command))
  }

  /** Schedule a `elyvel <command>` invocation. */
  command(elyvelCommand: string): ScheduledEvent {
    return this.add(
      new ScheduledEvent(() => runShell(`elyvel ${elyvelCommand}`)).named(`elyvel ${elyvelCommand}`),
    )
  }

  /** Events whose cron expression is due at `date` (ignores when/skip). */
  dueEvents(date: Date): ScheduledEvent[] {
    return this.events.filter(e => e.isDue(date))
  }

  /**
   * Run every event due this minute (minute granularity; sub-minute events run
   * once). Invoked by `schedule:run` from system cron once a minute.
   */
  async run(date = new Date()): Promise<ScheduleRunResult[]> {
    const results: ScheduleRunResult[] = []
    for (const event of this.events) {
      if (!(await event.shouldRun(date)))
        continue
      await this.execute(event, date, results)
    }
    // `schedule:run` is one-shot and its caller exits straight after, so wait
    // for the background tasks rather than letting `process.exit` kill them.
    // They still ran concurrently with each other and with the foreground
    // tasks — we only join at the end.
    await this.drainBackground()
    return results
  }

  /**
   * Await every background task started but not yet finished. `run()` does this
   * for you; `tick()` deliberately doesn't (it's a long-lived loop), so
   * `schedule:work` should call this on shutdown to avoid cutting tasks short.
   */
  async drainBackground(): Promise<void> {
    while (this.backgroundRuns.length > 0) {
      const pending = this.backgroundRuns.splice(0, this.backgroundRuns.length)
      await Promise.allSettled(pending)
    }
  }

  /**
   * A single per-second tick for `schedule:work`: runs sub-minute events at
   * their aligned second and minute-granular events on the minute boundary.
   */
  async tick(date = new Date()): Promise<ScheduleRunResult[]> {
    const seconds = date.getSeconds()
    const results: ScheduleRunResult[] = []
    for (const event of this.events) {
      const repeat = event.repeatEverySeconds
      const aligned = repeat ? seconds % repeat === 0 : seconds === 0
      if (!aligned)
        continue
      if (!(await event.shouldRun(date)))
        continue
      await this.execute(event, date, results)
    }
    return results
  }

  private async execute(
    event: ScheduledEvent,
    date: Date,
    results: ScheduleRunResult[],
  ): Promise<void> {
    if (event.runsInBackground) {
      // Start it without blocking the rest of the tick, but KEEP the promise.
      // Fire-and-forget meant `schedule:run` resolved, the CLI called
      // `process.exit`, and any background task still awaiting (an HTTP call, a
      // DB query) was truncated mid-flight — with `.catch(() => {})` and the
      // failure logger both gone with the process. It also reported `ran: true`
      // before the task had done anything, so a run a mutex DECLINED printed ✓.
      const record: ScheduleRunResult = { name: event.name, expression: event.expression, ran: false }
      results.push(record)
      this.backgroundRuns.push(
        event
          .run(date)
          .then((ran) => {
            record.ran = ran
          })
          .catch((error: unknown) => {
            record.error = error
          }),
      )
      return
    }
    try {
      const ran = await event.run(date)
      results.push({ name: event.name, expression: event.expression, ran })
    }
    catch (error) {
      results.push({ name: event.name, expression: event.expression, ran: true, error })
    }
  }
}

async function runShell(command: string): Promise<void> {
  // Pipe output through console.log so sendOutputTo/emailOutputTo can capture it.
  const proc = Bun.spawn(['sh', '-c', command], { stdout: 'pipe', stderr: 'pipe' })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (out.trim())
    console.log(out.trimEnd())
  if (err.trim())
    console.error(err.trimEnd())
  if (code !== 0)
    throw new Error(`Scheduled command failed (exit ${code}): ${command}`)
}

// ── process-wide default (set by ScheduleServiceProvider at boot) ────────────
let defaultSchedule: Schedule | null = null
export function setDefaultSchedule(schedule: Schedule): void {
  defaultSchedule = schedule
}
export function schedule(): Schedule {
  if (!defaultSchedule)
    defaultSchedule = new Schedule()
  return defaultSchedule
}
