import { ScheduledEvent } from './event'

/** Anything with a `handle()` — e.g. an `@elysia-ravel/queue` Job. */
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
 * every minute by `ravel schedule:run` from system cron).
 */
export class Schedule {
  readonly events: ScheduledEvent[] = []

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

  /** Schedule a `ravel <command>` invocation. */
  command(ravelCommand: string): ScheduledEvent {
    return this.add(new ScheduledEvent(() => runShell(`ravel ${ravelCommand}`)).named(`ravel ${ravelCommand}`))
  }

  /** Events whose cron expression is due at `date` (ignores when/skip). */
  dueEvents(date: Date): ScheduledEvent[] {
    return this.events.filter((e) => e.isDue(date))
  }

  /**
   * Run every event due this minute (minute granularity; sub-minute events run
   * once). Invoked by `schedule:run` from system cron once a minute.
   */
  async run(date = new Date()): Promise<ScheduleRunResult[]> {
    const results: ScheduleRunResult[] = []
    for (const event of this.events) {
      if (!(await event.shouldRun(date))) continue
      await this.execute(event, date, results)
    }
    return results
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
      if (!aligned) continue
      if (!(await event.shouldRun(date))) continue
      await this.execute(event, date, results)
    }
    return results
  }

  private async execute(event: ScheduledEvent, date: Date, results: ScheduleRunResult[]): Promise<void> {
    if (event.runsInBackground) {
      // fire-and-forget; the event's own onFailure hooks handle errors
      void event.run(date).catch(() => {})
      results.push({ name: event.name, expression: event.expression, ran: true })
      return
    }
    try {
      const ran = await event.run(date)
      results.push({ name: event.name, expression: event.expression, ran })
    } catch (error) {
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
  if (out.trim()) console.log(out.trimEnd())
  if (err.trim()) console.error(err.trimEnd())
  if (code !== 0) throw new Error(`Scheduled command failed (exit ${code}): ${command}`)
}

// ── process-wide default (set by ScheduleServiceProvider at boot) ────────────
let defaultSchedule: Schedule | null = null
export function setDefaultSchedule(schedule: Schedule): void {
  defaultSchedule = schedule
}
export function schedule(): Schedule {
  if (!defaultSchedule) defaultSchedule = new Schedule()
  return defaultSchedule
}
