import { configureDatabaseCache } from '@elyvel/cache'
import { configureDatabaseSession, ServiceProvider } from '@elyvel/core'
import { configureDatabaseQueue, configureFailedJobs, dispatch, registerJob } from '@elyvel/queue'
import { schedule } from '@elyvel/scheduler'
import { GenerateReportJob } from '../jobs/GenerateReportJob'
import { SendWelcomeNotificationJob } from '../jobs/SendWelcomeNotificationJob'
import { eloquentCacheAdapter } from '../support/cache-db'
import { eloquentFailedJobAdapter, eloquentQueueAdapter } from '../support/queue-db'
import { eloquentSessionAdapter } from '../support/session-db'

/**
 * The application's own service provider — bind app-wide services into the
 * container (in `register`) and run startup logic (in `boot`).
 */
export class AppServiceProvider extends ServiceProvider {
  override boot(): void {
    const appName = this.app.config.get<string>('app.name')
    this.app.logger.child('app').info('application booted', { appName })

    // Jobs must be registered in every process that reconstructs them off the
    // queue (the web server AND `elyvel queue:work`), not just where they're
    // dispatched from.
    registerJob(SendWelcomeNotificationJob, GenerateReportJob)
    configureDatabaseQueue(eloquentQueueAdapter)
    configureFailedJobs(eloquentFailedJobAdapter)
    configureDatabaseCache(eloquentCacheAdapter)
    configureDatabaseSession(eloquentSessionAdapter)

    // Runs under `elyvel schedule:work` (or `schedule:run` from system cron).
    schedule()
      .call(() => dispatch(new GenerateReportJob('scheduled-report')))
      .named('dispatch scheduled GenerateReportJob')
      .everyMinute()

    // Custom error pages (optional). The framework ships styled defaults; return
    // your own HTML / a view / a Response here to override — `undefined` keeps
    // the default. Only runs for browser navigations; API clients always get JSON.
    //
    //   import { configureErrorPage } from '@elyvel/core'
    //   configureErrorPage((status, { message }) =>
    //     status === 404 ? view('errors/404', { message }) : undefined)
  }
}
