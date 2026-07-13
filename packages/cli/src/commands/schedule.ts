import { createApp } from '@elysia-ravel/core'
import { ScheduleToken } from '@elysia-ravel/scheduler'

/**
 * `ravel schedule:run` — run every task that is due right now. Point a single
 * system cron entry at this every minute:
 *   * * * * * cd /path/to/app && ravel schedule:run >> /dev/null 2>&1
 */
export async function scheduleRunCommand(): Promise<number> {
  const app = await createApp({ basePath: process.cwd(), autoloadRoutes: false })
  const schedule = app.make(ScheduleToken)

  const results = await schedule.run()
  if (results.length === 0) {
    console.log('No scheduled tasks are due.')
    return 0
  }
  let failed = 0
  for (const r of results) {
    if (r.error) {
      failed++
      const detail = r.error instanceof Error ? r.error.message : String(r.error)
      console.error(`✗ ${r.name} — ${detail}`)
    } else if (r.ran) {
      console.log(`✓ ${r.name}`)
    } else {
      console.log(`· ${r.name} (skipped — overlapping)`)
    }
  }
  return failed > 0 ? 1 : 0
}

/** `ravel schedule:list` — show every registered task and its cron expression. */
export async function scheduleListCommand(): Promise<number> {
  const app = await createApp({ basePath: process.cwd(), autoloadRoutes: false })
  const schedule = app.make(ScheduleToken)

  if (schedule.events.length === 0) {
    console.log('No scheduled tasks defined. Add them in your ScheduleServiceProvider.')
    return 0
  }
  const width = Math.max(...schedule.events.map((e) => e.expression.length))
  for (const e of schedule.events) {
    const tz = e.timezoneName ? `  [${e.timezoneName}]` : ''
    console.log(`${e.expression.padEnd(width)}   ${e.name}${tz}`)
  }
  return 0
}
