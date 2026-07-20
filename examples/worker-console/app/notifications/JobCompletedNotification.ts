import type { Notifiable } from '@elyvel/notifications'
import { Message } from '@elyvel/mail'
import { Notification } from '@elyvel/notifications'

/**
 * Sent (via the `log` mail driver in this example — see config/mail.ts) when a
 * queued job finishes, so a job's completion is observable end-to-end without
 * needing a real SMTP server.
 */
export class JobCompletedNotification extends Notification {
  constructor(private readonly jobName: string, private readonly summary: string) {
    super()
  }

  override via(_notifiable: Notifiable): string[] {
    return ['mail']
  }

  override toMail(): Message {
    return new Message()
      .subject(`${this.jobName} finished`)
      .text(this.summary)
  }
}

export default JobCompletedNotification
