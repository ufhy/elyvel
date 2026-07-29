import type { ConsoleCommand } from '@elyvel/core'
import { comment, error, info } from '@elyvel/cli'
import { createApp } from '@elyvel/core'
import { ScheduleToken } from './provider'

/**
 * `elyvel schedule:run` — run every task that is due right now. Point a single
 * system cron entry at this every minute:
 *   cd /path/to/app && elyvel schedule:run >> /dev/null 2>&1
 * Failures are also logged through the app's own logger (ScheduleServiceProvider
 * wires this by default) — so redirecting stdout/stderr to /dev/null here is
 * safe and won't leave failures with no record anywhere, including for
 * runInBackground() tasks that never surface an error to this command at all.
 */
export async function scheduleRunCommand(): Promise<number> {
  const app = await createApp({ basePath: process.cwd(), autoloadRoutes: false })
  const schedule = app.make(ScheduleToken)

  const results = await schedule.run()
  if (results.length === 0) {
    comment('No scheduled tasks are due.')
    return 0
  }
  let failed = 0
  for (const r of results) {
    if (r.error) {
      failed++
      const detail = r.error instanceof Error ? r.error.message : String(r.error)
      error(`✗ ${r.name} — ${detail}`)
    }
    else if (r.ran) {
      info(`✓ ${r.name}`)
    }
    else {
      comment(`· ${r.name} (skipped — overlapping)`)
    }
  }
  return failed > 0 ? 1 : 0
}

/**
 * `elyvel schedule:work` — a long-running scheduler for local dev: ticks once a
 * minute and runs due tasks (so you don't need a system cron entry).
 */
export async function scheduleWorkCommand(): Promise<number> {
  const app = await createApp({ basePath: process.cwd(), autoloadRoutes: false })
  const schedule = app.make(ScheduleToken)
  info('Scheduler running. Ticks every second (sub-minute aware) — press Ctrl+C to stop.')
  // Tick once per second; Schedule.tick runs minute tasks on the boundary and
  // sub-minute tasks at their aligned second.
  let lastSecond: number | null = null
  for (;;) {
    const currentSecond = Math.floor(Date.now() / 1000)
    // Process every second since the previous tick, not just the current one.
    // The loop sleeps to the next second boundary, so a tick whose work ran
    // longer than a second woke at S+2 — and if S+1 was the `seconds === 0`
    // boundary, EVERY minute-granular task for that minute was silently
    // skipped. Catch-up is capped at a minute so a long pause (laptop sleep,
    // a debugger breakpoint) replays a bounded window instead of hours.
    const from = lastSecond === null ? currentSecond : Math.max(lastSecond + 1, currentSecond - 59)
    for (let second = from; second <= currentSecond; second++) {
      const results = await schedule.tick(new Date(second * 1000))
      for (const r of results) {
        if (r.error)
          error(`✗ ${r.name}`)
        else if (r.ran)
          info(`✓ ${r.name}`)
      }
    }
    lastSecond = currentSecond
    await new Promise(r => setTimeout(r, 1000 - (Date.now() % 1000)))
  }
}

/**
 * `elyvel schedule:test [name]` — run tasks immediately regardless of their cron
 * (all tasks, or one by name), for verifying task logic.
 */
export async function scheduleTestCommand(name?: string): Promise<number> {
  const app = await createApp({ basePath: process.cwd(), autoloadRoutes: false })
  const schedule = app.make(ScheduleToken)
  const events = name ? schedule.events.filter(e => e.name === name) : schedule.events
  if (events.length === 0) {
    error(name ? `No scheduled task named "${name}".` : 'No scheduled tasks defined.')
    return 1
  }
  let failed = 0
  for (const event of events) {
    try {
      // Ignore withoutOverlapping/onOneServer here. `run()` defaults `date` to
      // the epoch, so every invocation shared one onOneServer bucket — the
      // first `schedule:test` claimed it for 60s and never released it (by
      // design), and the return value was discarded, so a second run within
      // the minute printed ✓ for a task that hadn't executed at all.
      const ran = await event.run(new Date(), { ignoreLocks: true })
      if (ran)
        info(`✓ ${event.name}`)
      else
        info(`- ${event.name} (skipped)`)
    }
    catch (err) {
      failed++
      const detail = err instanceof Error ? err.message : String(err)
      error(`✗ ${event.name} — ${detail}`)
    }
  }
  return failed > 0 ? 1 : 0
}

/** `elyvel schedule:list` — show every registered task and its cron expression. */
export async function scheduleListCommand(): Promise<number> {
  const app = await createApp({ basePath: process.cwd(), autoloadRoutes: false })
  const schedule = app.make(ScheduleToken)

  if (schedule.events.length === 0) {
    comment('No scheduled tasks defined. Add them in your ScheduleServiceProvider.')
    return 0
  }
  const width = Math.max(...schedule.events.map(e => e.expression.length))
  for (const e of schedule.events) {
    const tz = e.timezoneName ? `  [${e.timezoneName}]` : ''
    info(`${e.expression.padEnd(width)}   ${e.name}${tz}`)
  }
  return 0
}

/** Discovered by `elyvel package:discover` — see `@elyvel/core`'s `ConsoleCommand`. */
export const elyvelCommands: ConsoleCommand[] = [
  {
    name: 'schedule:run',
    description: 'Run scheduled tasks that are due now',
    run: () => scheduleRunCommand(),
  },
  {
    name: 'schedule:work',
    description: 'Run the scheduler in-process (dev; ticks each minute)',
    run: () => scheduleWorkCommand(),
  },
  {
    name: 'schedule:test',
    description: 'Run scheduled tasks now regardless of cron',
    usage: '[name]',
    run: (_flags: Record<string, string | boolean>, args: string[]) => scheduleTestCommand(args[0]),
  },
  {
    name: 'schedule:list',
    description: 'List scheduled tasks and their cron',
    run: () => scheduleListCommand(),
  },
]
