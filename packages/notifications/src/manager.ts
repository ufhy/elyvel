import type { Channel } from './channels'
import type { Notifiable, Notification } from './notification'
import { failedNotifications } from './failed'
import { notifiableKey } from './notification'

/** Routes notifications to their channels (Laravel's notification dispatcher). */
export class NotificationManager {
  private readonly channels = new Map<string, Channel>()

  /** Register a channel implementation under a name used by `via()`. */
  channel(name: string, channel: Channel): this {
    this.channels.set(name, channel)
    return this
  }

  /**
   * Send a notification to one notifiable across the channels its `via()`
   * returns. Every channel gets its own attempt — one channel throwing
   * doesn't stop the rest from running (previously it did, silently dropping
   * whichever channels came after the one that failed). Each failure is
   * recorded via {@link configureFailedNotifications} (if wired); after all
   * channels have run, this still rejects if any of them failed, so existing
   * callers that `await`/`catch` this see the same "it failed" signal as
   * before — they just no longer lose the channels that would have run after it.
   */
  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    const errors: unknown[] = []
    for (const name of notification.via(notifiable)) {
      const channel = this.channels.get(name)
      if (!channel)
        continue
      try {
        await channel.send(notifiable, notification)
      }
      catch (error) {
        errors.push(error)
        await failedNotifications()?.log(
          notifiable.constructor?.name ?? 'unknown',
          String(notifiableKey(notifiable) ?? ''),
          name,
          notification.constructor.name,
          error,
        )
      }
    }
    if (errors.length > 0)
      throw errors.length === 1 ? errors[0] : new AggregateError(errors, 'One or more notification channels failed')
  }

  /** Send to many notifiables. One notifiable failing doesn't stop the rest. */
  async sendMany(notifiables: Notifiable[], notification: Notification): Promise<void> {
    const errors: unknown[] = []
    for (const notifiable of notifiables) {
      try {
        await this.send(notifiable, notification)
      }
      catch (error) {
        errors.push(error)
      }
    }
    if (errors.length > 0)
      throw errors.length === 1 ? errors[0] : new AggregateError(errors, 'One or more notifiables failed')
  }
}

// ── process-wide default (set by NotificationServiceProvider at boot) ────────
let defaultManager: NotificationManager | null = null
export function setDefaultNotifications(manager: NotificationManager): void {
  defaultManager = manager
}
export function notifications(): NotificationManager {
  if (!defaultManager)
    defaultManager = new NotificationManager()
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
