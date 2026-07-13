import { dispatch } from '@elysia-ravel/queue'
import { ScheduleServiceProvider as BaseScheduleServiceProvider, type Schedule } from '@elysia-ravel/scheduler'
import { SendWelcomeEmail } from '../jobs/SendWelcomeEmail'

/** Define the application's scheduled tasks here (à la Laravel's console Kernel). */
export class ScheduleServiceProvider extends BaseScheduleServiceProvider {
  protected override schedule(schedule: Schedule): void {
    // A heartbeat closure every minute.
    schedule
      .call(() => console.log(`[schedule] heartbeat ${new Date().toISOString()}`))
      .everyMinute()
      .named('heartbeat')

    // Sub-minute health check (only realized under `ravel schedule:work`).
    schedule
      .call(() => console.log('[schedule] 30s health check'))
      .everyThirtySeconds()
      .named('health-check')

    // Enqueue a digest job every day at 08:00 (Asia/Makassar), without overlap.
    schedule
      .call(() => dispatch(new SendWelcomeEmail('digest@example.com')))
      .dailyAt('08:00')
      .timezone('Asia/Makassar')
      .withoutOverlapping()
      .onFailure((error) => console.error('[schedule] daily-digest failed', error))
      .named('daily-digest')

    // Prune stale model records weekly, on Sundays, via the CLI — in the
    // background so it doesn't block the rest of the schedule. Skipped locally.
    schedule
      .command('model:prune')
      .weeklyOn(0, '02:00')
      .environments('production')
      .runInBackground()
      .named('weekly-prune')
  }
}
