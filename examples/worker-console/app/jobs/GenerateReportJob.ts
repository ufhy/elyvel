import { cache } from '@elyvel/cache'
import { notify } from '@elyvel/notifications'
import { Job } from '@elyvel/queue'
import { JobCompletedNotification } from '../notifications/JobCompletedNotification'

const DEMO_RECIPIENT = { routeNotificationFor: (channel: string) => channel === 'mail' ? 'demo@example.test' : undefined }

/**
 * Deliberately flaky (fails ~60% of the time) to exercise retry/backoff and
 * the failed_jobs table for real — dispatched from POST /jobs/report and by
 * the scheduled task in AppServiceProvider.
 */
export class GenerateReportJob extends Job {
  override tries = 3
  override backoff = [1, 3, 5]

  constructor(public reportName = 'daily-summary') {
    super()
  }

  async handle(): Promise<void> {
    if (Math.random() < 0.6)
      throw new Error(`transient failure generating report "${this.reportName}"`)

    await notify(DEMO_RECIPIENT, new JobCompletedNotification('GenerateReportJob', `Report "${this.reportName}" generated.`))
    await cache().increment('jobs:processed')
  }

  override async failed(error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`GenerateReportJob("${this.reportName}") gave up after ${this.tries} attempts: ${message}`)
  }
}

export default GenerateReportJob
