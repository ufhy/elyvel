# Task Scheduling

Define your app's cron schedule as code, in one place, instead of scattering
`crontab` entries across servers. One system cron entry (or a single dev
command) drives everything.

## Defining the schedule

Override `schedule()` in a `ScheduleServiceProvider` subclass:

```ts
// app/providers/ScheduleServiceProvider.ts
import type { Schedule } from '@elyvel/scheduler'
import { ScheduleServiceProvider as BaseScheduleServiceProvider } from '@elyvel/scheduler'

export class ScheduleServiceProvider extends BaseScheduleServiceProvider {
  protected override schedule(schedule: Schedule): void {
    schedule
      .call(() => Post.publishDue())
      .named('publish-scheduled-posts')
      .everyMinute()

    schedule
      .command('model:prune')
      .named('prune-models')
      .daily()
  }
}
```

Register it like any other provider in `config/app.ts`. Every registration
returns a chainable `ScheduledEvent` for setting the frequency and any
constraints.

Frequency methods: `everyMinute()`, `everyTwoMinutes()`,
`everyFiveMinutes()`, `everyTenMinutes()`, `everyFifteenMinutes()`,
`everyThirtyMinutes()`, `hourly()`, `hourlyAt(minute)`, `daily()`,
`dailyAt('HH:MM')`, `twiceDaily(first?, second?)`, `weekly()`,
`weeklyOn(day, time?)`, `monthly()`, `monthlyOn(day?, time?)`,
`quarterly()`, `yearly()`, day-of-week filters (`weekdays()`, `weekends()`,
`sundays()`…`saturdays()`, `days(...)`), and raw `cron('* * * * *')`.
Sub-minute frequencies (`everySecond()`, `everyFiveSeconds()`, ...) only
take effect under `schedule:work`, not the once-a-minute `schedule:run`.

## Task types

```ts
schedule.call(() => cleanupTempFiles())        // a closure
schedule.exec('convert input.jpg output.webp') // a raw shell command
schedule.command('cache:prune-stale-tags')     // an `elyvel` CLI command
schedule.job(new GenerateReportJob())          // runs handle() inline, synchronously
```

`job(...)` runs the job's `handle()` directly, not through the queue — for
background/queued execution instead, schedule a closure that dispatches it:

```ts
schedule.call(() => dispatch(new GenerateReportJob('scheduled-report'))).everyMinute()
```

## Constraints

```ts
schedule.call(sendDigest).daily()
  .when(() => featureEnabled('digest'))
  .environments('production')
  .timezone('Asia/Jakarta')
  .between('08:00', '18:00') // only run inside this window (handles overnight ranges too)
```

`when(fn)` runs only if `fn()` is truthy; `skip(fn)` is the inverse.
`environments(...)` restricts to specific `app.env` values. `timezone(tz)`
(an IANA zone) applies to cron evaluation and any time-window check.

## Preventing overlaps

```ts
schedule.call(longRunningReport).hourly().withoutOverlapping(120) // lock expires after 120 min
schedule.call(cleanup).daily().onOneServer()  // only one instance runs it
schedule.call(pingHealthcheck).everyMinute().runInBackground() // don't block the rest of the schedule
```

`withoutOverlapping()` and `onOneServer()` are per-process (in-memory) by
default — fine for a single instance, but a no-op guarantee across
multiple instances until you wire a shared mutex:

```ts
import { configureScheduleMutex, RedisScheduleMutex } from '@elyvel/scheduler'

configureScheduleMutex(new RedisScheduleMutex(redisClient))
```

`runInBackground()` fires the task without awaiting it, so a slow task
doesn't delay the rest of that tick's schedule — its `onFailure` hook (and
the failure logger, below) still fire if it throws.

## Failure & success hooks

```ts
schedule.call(syncInventory).hourly()
  .onSuccess(() => metrics.increment('inventory.synced'))
  .onFailure(error => alertOncall(error))
  .thenPing('https://healthchecks.io/ping/xyz')
```

Also available: `before(fn)`/`after(fn)` (run regardless of outcome),
`pingBefore(url)`/`pingOnSuccess(url)`/`pingOnFailure(url)`, and output
capture (`sendOutputTo(path)`, `appendOutputTo(path)`,
`emailOutputTo(address)`).

Independent of any `.onFailure()` you write, every task failure — including
`runInBackground()` tasks whose errors never reach the CLI's own output —
is logged to the `scheduler` channel automatically, so a silently-failing
cron job still leaves a trace. See [Logging](/digging-deeper/logging).

## Running the scheduler

```bash
elyvel schedule:run      # run everything due right now — call this every minute from system cron
elyvel schedule:work     # long-running loop, ticks every second — no system cron needed for local dev
elyvel schedule:test     # run every task immediately, ignoring its cron expression
elyvel schedule:test publish-scheduled-posts   # run just one task by name
elyvel schedule:list     # print every task's cron expression, name, and timezone
```

Production setup is one crontab line:

```
* * * * * cd /path/to/app && elyvel schedule:run >> /dev/null 2>&1
```

::: warning No maintenance-mode gate yet
Unlike Laravel, scheduled tasks here aren't automatically skipped while the
app is in maintenance mode — there's no `evenInMaintenanceMode()` escape
hatch because there's no gate to escape. If a task shouldn't run during
maintenance, guard it explicitly with `.when(() => !isDownForMaintenance())`.
:::

## Testing

```ts
const event = new ScheduledEvent(() => {}).cron('0 8 * * *').timezone('UTC')

event.isDue(someDate)              // cron match only
await event.shouldRun(someDate)    // cron + environment + when/skip
```

For a full run, build a `Schedule`, register tasks, and call
`schedule.run(fixedDate)` — it returns one `{ name, expression, ran, error? }`
per due task (`ran: false` means it was due but skipped by an overlap
lock), letting you assert both scheduling logic and the task's actual side
effects in one go.
