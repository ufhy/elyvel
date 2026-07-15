import {
  type Channel,
  type Notifiable,
  type Notification,
  notifiableKey,
  routeFor,
} from '@elysia-ravel/notifications'
import { broadcaster } from './manager'

/**
 * The `broadcast` notification channel — pushes `notification.toBroadcast()` to
 * a channel (the notifiable's `broadcast` route, or `notifications.<id>`).
 * Register it: `notifications().channel('broadcast', new BroadcastChannel())`.
 */
export class BroadcastChannel implements Channel {
  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    if (!notification.toBroadcast) return
    const payload = notification.toBroadcast(notifiable)
    const route = routeFor(notifiable, 'broadcast')
    const channel =
      route !== undefined ? String(route) : `notifications.${String(notifiableKey(notifiable))}`
    await broadcaster().broadcast([channel], notification.constructor.name, payload)
  }
}
