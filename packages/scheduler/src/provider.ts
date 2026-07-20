import type { Token } from '@elyvel/core'
import { ServiceProvider, token } from '@elyvel/core'
import { configureScheduleFailureLogger, setSchedulerEnvironment } from './event'
import { Schedule, setDefaultSchedule } from './schedule'

export const ScheduleToken: Token<Schedule> = token<Schedule>('schedule')

/**
 * Base schedule service provider. Subclass it and override `schedule(schedule)`
 * to define your scheduled tasks, à la Laravel's console Kernel. Binds the
 * {@link Schedule} to {@link ScheduleToken} and sets it as the process default.
 */
export class ScheduleServiceProvider extends ServiceProvider {
  /** Define scheduled tasks here (override in the app). */
  protected schedule(_schedule: Schedule): void {}

  override register(): void {
    const env = this.app.config.get<string>('app.env', 'production')
    setSchedulerEnvironment(env)
    const schedule = new Schedule()
    this.schedule(schedule)
    setDefaultSchedule(schedule)
    this.app.container.instance(ScheduleToken, schedule)

    // Every task failure is logged through the app's real logger by default —
    // without this, a task with no .onFailure() hook (the common case) had
    // no durable record of failing anywhere, `runInBackground()` tasks most
    // of all (see configureScheduleFailureLogger's doc comment).
    const log = this.app.logger.child('scheduler')
    configureScheduleFailureLogger((event, error) => {
      log.error(`scheduled task failed: ${event.name}`, {
        expression: event.expression,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
    })
  }
}
