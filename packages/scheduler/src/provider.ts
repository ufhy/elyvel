import type { Token } from '@elyvel/core'
import { ServiceProvider, token } from '@elyvel/core'
import { setSchedulerEnvironment } from './event'
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
  }
}
