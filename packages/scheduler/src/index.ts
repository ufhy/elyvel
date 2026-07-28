import { ScheduleServiceProvider } from './provider'

export { cronMatches, parseCron, parseCronField, partsInZone } from './cron'
export {
  configureScheduleFailureLogger,
  configureScheduleMailer,
  ScheduledEvent,
  setSchedulerEnvironment,
} from './event'
export {
  configureScheduleMutex,
  MemoryScheduleMutex,
  type RedisLike,
  RedisScheduleMutex,
  type ScheduleMutex,
  scheduleMutex,
} from './mutex'
export { ScheduleServiceProvider, ScheduleToken } from './provider'

/** Read by `elyvel package:discover` — see packages/core's discovery loader. */
export const elyvelProviders = [ScheduleServiceProvider]
// CLI commands (`elyvelCommands`) live at the `@elyvel/scheduler/cli` subpath,
// not here — so a running app importing this main entry never loads them.
export { Schedule, schedule, type ScheduleRunResult, setDefaultSchedule } from './schedule'
