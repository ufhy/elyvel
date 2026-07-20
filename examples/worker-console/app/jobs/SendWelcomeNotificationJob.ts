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
  }
}

export default SendWelcomeNotificationJob
