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

    // Enqueue a digest job every day at 08:00 (Asia/Makassar), without overlap.
    schedule
      .call(() => dispatch(new SendWelcomeEmail('digest@example.com')))
      .dailyAt('08:00')
      .timezone('Asia/Makassar')
      .withoutOverlapping()
      .named('daily-digest')

    // Prune stale model records weekly, on Sundays, via the CLI.
    schedule.command('model:prune').weeklyOn(0, '02:00').named('weekly-prune')
  }
}
