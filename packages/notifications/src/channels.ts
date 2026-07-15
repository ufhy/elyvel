import { randomUUID } from 'node:crypto'
import { mailManager } from '@elysia-ravel/mail'
import { telegram } from '@elysia-ravel/telegram'
import { type Notifiable, type Notification, notifiableKey, routeFor } from './notification'

/** A delivery channel — sends a notification to a notifiable. */
export interface Channel {
  send(notifiable: Notifiable, notification: Notification): Promise<void>
}

/** Collects notifications in memory (tests / debugging). */
export class ArrayChannel implements Channel {
  readonly sent: {
    notifiable: Notifiable
    notification: Notification
    data: Record<string, unknown>
  }[] = []
  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    const data = notification.toArray?.(notifiable) ?? notification.toDatabase?.(notifiable) ?? {}
    this.sent.push({ notifiable, notification, data })
  }
}

/** Sends via the mail package using `notification.toMail()`. */
export class MailChannel implements Channel {
  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    if (!notification.toMail) return
    const message = notification.toMail(notifiable)
    if (message.toAddresses.length === 0) {
      const to = routeFor(notifiable, 'mail')
      if (to !== undefined) message.to(String(to))
    }
    await mailManager().deliver(message)
  }
}

/** Sends via the telegram package using `notification.toTelegram()`. */
export class TelegramChannel implements Channel {
  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    if (!notification.toTelegram) return
    const payload = notification.toTelegram(notifiable)
    const message = typeof payload === 'string' ? { text: payload } : payload
    const chatId = message.chatId ?? routeFor(notifiable, 'telegram')
    await telegram().sendMessage({ ...message, chatId })
  }
}

/** Persist notifications for in-app display (DB-agnostic; wire via configureDatabaseNotifications). */
export interface StoredNotification {
  id: string
  type: string
  notifiableId: unknown
  data: Record<string, unknown>
  readAt: number | null
  createdAt: number
}
export interface NotificationDbAdapter {
  insert(record: StoredNotification): Promise<void>
}

let dbAdapter: NotificationDbAdapter | null = null
export function configureDatabaseNotifications(adapter: NotificationDbAdapter): void {
  dbAdapter = adapter
}

export class DatabaseChannel implements Channel {
  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    if (!dbAdapter)
      throw new Error(
        '[elysia-ravel] database notifications need configureDatabaseNotifications(...).',
      )
    const data = notification.toDatabase?.(notifiable) ?? notification.toArray?.(notifiable) ?? {}
    await dbAdapter.insert({
      id: randomUUID(),
      type: notification.constructor.name,
      notifiableId: notifiableKey(notifiable),
      data,
      readAt: null,
      createdAt: Date.now(),
    })
  }
}
