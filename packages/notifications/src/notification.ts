import type { Message } from '@elyvel/mail'
import type { TelegramMessage } from '@elyvel/telegram'

/**
 * A recipient of notifications. `routeNotificationFor(channel)` returns the
 * per-channel address (email for `mail`, chat id for `telegram`, …). For the
 * `database` channel, `getKey()`/`id` identifies the owner row.
 */
export interface Notifiable {
  routeNotificationFor?(channel: string): string | number | undefined
  getKey?(): unknown
  id?: unknown
}

/**
 * A notification (Laravel's `Notification`). `via()` picks the channels; each
 * `to<Channel>()` shapes the payload for that channel. Only implement the
 * channels you return from `via()`.
 */
/**
 * A channel class, referenced directly from `via()`. Laravel's ChannelManager
 * falls back to `class_exists($driver)` and resolves it from the container,
 * which is what lets a third-party package ship a channel nobody registered:
 * the class IS the identifier.
 */
export type ChannelClass = new () => {
  send(notifiable: Notifiable, notification: Notification): Promise<void>
}

export abstract class Notification {
  /**
   * Which channels deliver this. A string names a registered channel; a class is
   * instantiated directly, so a package's channel needs no registration:
   *
   * ```ts
   * via() { return ['mail', WhatsAppChannel] }
   * ```
   */
  abstract via(notifiable: Notifiable): (string | ChannelClass)[]
  toMail?(notifiable: Notifiable): Message
  toDatabase?(notifiable: Notifiable): Record<string, unknown>
  toArray?(notifiable: Notifiable): Record<string, unknown>
  toTelegram?(notifiable: Notifiable): string | TelegramMessage
  toBroadcast?(notifiable: Notifiable): Record<string, unknown>
}

/** The per-channel route for a notifiable (or undefined). */
export function routeFor(notifiable: Notifiable, channel: string): string | number | undefined {
  return notifiable.routeNotificationFor?.(channel)
}

/** A stable identity for a notifiable (for the database channel). */
export function notifiableKey(notifiable: Notifiable): unknown {
  return notifiable.getKey?.() ?? notifiable.id
}
