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

  /** Run every event that should run now. Returns a per-event result log. */
  async run(date = new Date()): Promise<ScheduleRunResult[]> {
    const results: ScheduleRunResult[] = []
    for (const event of this.events) {
      if (!(await event.shouldRun(date))) continue
      if (event.runsInBackground) {
        // fire-and-forget; the event's own onFailure hooks handle errors
        void event.run(date).catch(() => {})
        results.push({ name: event.name, expression: event.expression, ran: true })
        continue
      }
      try {
        const ran = await event.run(date)
        results.push({ name: event.name, expression: event.expression, ran })
      } catch (error) {
        results.push({ name: event.name, expression: event.expression, ran: true, error })
      }
    }
    return results
  }
}

async function runShell(command: string): Promise<void> {
  const proc = Bun.spawn(['sh', '-c', command], { stdio: ['inherit', 'inherit', 'inherit'] })
  const code = await proc.exited
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
