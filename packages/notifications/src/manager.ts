import type { Channel } from './channels'
import type { ChannelClass, Notifiable, Notification } from './notification'
import { failedNotifications } from './failed'
import { notifiableKey } from './notification'

/** Routes notifications to their channels (Laravel's notification dispatcher). */
export class NotificationManager {
  private readonly channels = new Map<string, Channel>()
  private readonly classChannels = new Map<ChannelClass, Channel>()

  /** Register a channel implementation under a name used by `via()`. */
  channel(name: string, channel: Channel): this {
    this.channels.set(name, channel)
    return this
  }

  /**
   * The instance for a channel class named directly in `via()`. Cached per
   * class: a channel that opens a connection (an HTTP client, a socket) must not
   * be reconstructed for every notification sent.
   */
  private byClass(Channel: ChannelClass): Channel {
    let instance = this.classChannels.get(Channel)
    if (!instance) {
      instance = new Channel() as Channel
      this.classChannels.set(Channel, instance)
    }
    return instance
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
    for (const via of notification.via(notifiable)) {
      // A class resolves to itself — one instance per class, cached, so a
      // channel holding a connection isn't rebuilt for every notification.
      const name = typeof via === 'string' ? via : (via.name || 'anonymous channel')
      const channel = typeof via === 'string' ? this.channels.get(via) : this.byClass(via)
      if (!channel) {
        // A `via()` naming a channel nobody registered used to `continue`, so
        // `send()` resolved having delivered NOTHING. This is not theoretical:
        // `toBroadcast()` exists on Notification, but the default
        // NotificationServiceProvider registers only array/mail/telegram/
        // database — so `via: () => ['broadcast']` in a stock app was a total
        // silent drop. Treat it like any other channel failure: record it, keep
        // the other channels going, and reject at the end.
        const error = new Error(
          `[elyvel] No notification channel registered under "${name}". `
          + `Register it (e.g. notifications().channel('${name}', ...)) or remove `
          + `it from via().`,
        )
        errors.push(error)
        await failedNotifications()?.log(
          notifiable.constructor?.name ?? 'unknown',
          String(notifiableKey(notifiable) ?? ''),
          name,
          notification.constructor.name,
          error,
        )
        continue
      }
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
