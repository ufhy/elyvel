import type { Channel } from './channels'
import type { Notifiable, Notification } from './notification'

/** Routes notifications to their channels (Laravel's notification dispatcher). */
export class NotificationManager {
  private readonly channels = new Map<string, Channel>()

  /** Register a channel implementation under a name used by `via()`. */
  channel(name: string, channel: Channel): this {
    this.channels.set(name, channel)
    return this
  }

  /** Send a notification to one notifiable across the channels its `via()` returns. */
  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    for (const name of notification.via(notifiable)) {
      const channel = this.channels.get(name)
      if (channel) await channel.send(notifiable, notification)
    }
  }

  /** Send to many notifiables. */
  async sendMany(notifiables: Notifiable[], notification: Notification): Promise<void> {
    for (const notifiable of notifiables) await this.send(notifiable, notification)
  }
}

// ── process-wide default (set by NotificationServiceProvider at boot) ────────
let defaultManager: NotificationManager | null = null
export function setDefaultNotifications(manager: NotificationManager): void {
  defaultManager = manager
}
export function notifications(): NotificationManager {
  if (!defaultManager) defaultManager = new NotificationManager()
  return defaultManager
}

/** Send a notification (Laravel's `Notification::send` / `$user->notify()`). */
export function notify(
  notifiable: Notifiable | Notifiable[],
  notification: Notification,
): Promise<void> {
  return Array.isArray(notifiable)
    ? notifications().sendMany(notifiable, notification)
    : notifications().send(notifiable, notification)
}
