import type { Channel, Notifiable, Notification } from '@elyvel/notifications'
import {

  notifiableKey,
  routeFor,
} from '@elyvel/notifications'
import { broadcaster } from './manager'

/**
 * The `broadcast` notification channel — pushes `notification.toBroadcast()` to
 * a channel (the notifiable's `broadcast` route, or `notifications.<id>`).
 * Register it: `notifications().channel('broadcast', new BroadcastChannel())`.
 */
export class BroadcastChannel implements Channel {
  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    if (!notification.toBroadcast)
      return
    const payload = notification.toBroadcast(notifiable)
    const route = routeFor(notifiable, 'broadcast')
    // The default MUST carry the `private-` prefix. `notifications.<id>` has no
    // prefix, so `BroadcastHub.isAuthorized` short-circuits to `true` and ANY
    // unauthenticated socket could subscribe to `notifications.7` and read
    // user 7's notification payloads. `BroadcastServiceProvider` registers the
    // matching authorizer (identity's key must equal the channel's key).
    const channel
      = route !== undefined
        ? String(route)
        : `private-notifications.${String(notifiableKey(notifiable))}`
    await broadcaster().broadcast([channel], notification.constructor.name, payload)
  }
}
