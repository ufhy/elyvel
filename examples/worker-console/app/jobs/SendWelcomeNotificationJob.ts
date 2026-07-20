import { cache } from '@elyvel/cache'
import { notify } from '@elyvel/notifications'
import { Job } from '@elyvel/queue'
import { JobCompletedNotification } from '../notifications/JobCompletedNotification'

const DEMO_RECIPIENT = { routeNotificationFor: (channel: string) => channel === 'mail' ? 'demo@example.test' : undefined }

/** Fast, always-succeeds job — dispatched from POST /jobs/welcome. */
export class SendWelcomeNotificationJob extends Job {
  constructor(public name = 'friend') {
    super()
  }

  async handle(): Promise<void> {
    await notify(DEMO_RECIPIENT, new JobCompletedNotification('SendWelcomeNotificationJob', `Welcome email queued for ${this.name}.`))
    // Written from the queue:work process, read back on the dashboard route
    // (a different process) — proves the database cache store is shared, not
    // per-process.
    await cache().increment('jobs:processed')
  }
}

export default SendWelcomeNotificationJob
