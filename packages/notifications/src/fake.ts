import type { Notifiable, Notification } from './notification'
import { NotificationManager, setDefaultNotifications } from './manager'
import { notifiableKey } from './notification'

type NotificationClass = new (...args: never[]) => Notification
type NotificationPredicate = (notification: Notification, notifiable: Notifiable) => boolean

interface SentRecord {
  notifiable: Notifiable
  notification: Notification
}

/**
 * A NotificationManager that records instead of delivering — Laravel's
 * `Notification::fake()`.
 *
 * `ArrayChannel` existed, but it only captures notifications whose `via()`
 * happens to include `'array'` — a test would have to rewrite the notification
 * under test to observe it. The fake replaces the manager, so every
 * notification is captured regardless of its channels, and none of its channels
 * run: no mail, no HTTP call to Telegram, no database row.
 */
export class NotificationFake extends NotificationManager {
  readonly records: SentRecord[] = []

  override async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    this.records.push({ notifiable, notification })
  }

  /** Records for one notifiable (matched by reference, or by model key). */
  sentTo(notifiable: Notifiable, match?: NotificationClass | NotificationPredicate): SentRecord[] {
    let hits = this.records.filter(r => sameNotifiable(r.notifiable, notifiable))
    if (match) {
      hits = isNotificationClass(match)
        ? hits.filter(r => r.notification instanceof match)
        : hits.filter(r => match(r.notification, r.notifiable))
    }
    return hits
  }

  /** Assert this notifiable received a matching notification. */
  assertSentTo(
    notifiable: Notifiable,
    match: NotificationClass | NotificationPredicate,
    callback?: NotificationPredicate,
  ): void {
    let hits = this.sentTo(notifiable, match)
    if (callback)
      hits = hits.filter(r => callback(r.notification, r.notifiable))
    if (hits.length === 0) {
      throw new Error(
        `Expected ${describe(match)} to have been sent to the notifiable, but it was not${this.summarise()}`,
      )
    }
  }

  assertSentToTimes(notifiable: Notifiable, match: NotificationClass | NotificationPredicate, times: number): void {
    const count = this.sentTo(notifiable, match).length
    if (count !== times) {
      throw new Error(
        `Expected ${describe(match)} to have been sent ${times} time(s) to the notifiable, but it was sent ${count} time(s).`,
      )
    }
  }

  assertNotSentTo(notifiable: Notifiable, match: NotificationClass | NotificationPredicate): void {
    if (this.sentTo(notifiable, match).length > 0)
      throw new Error(`Expected ${describe(match)} NOT to have been sent to the notifiable, but it was.`)
  }

  /** Assert this notifiable received nothing at all. */
  assertNothingSentTo(notifiable: Notifiable): void {
    const count = this.sentTo(notifiable).length
    if (count > 0) {
      throw new Error(
        `Expected nothing to have been sent to the notifiable, but ${count} notification(s) were.`,
      )
    }
  }

  assertNothingSent(): void {
    if (this.records.length > 0) {
      throw new Error(
        `Expected no notifications to have been sent, but ${this.records.length} were${this.summarise()}`,
      )
    }
  }

  assertCount(count: number): void {
    if (this.records.length !== count) {
      throw new Error(
        `Expected ${count} notification(s) to have been sent, but ${this.records.length} were.`,
      )
    }
  }

  private summarise(): string {
    if (this.records.length === 0)
      return '. Nothing was sent.'
    const names = this.records.slice(0, 8).map(r => r.notification.constructor.name)
    return `. Sent: ${names.join(', ')}${this.records.length > 8 ? ', …' : ''}.`
  }
}

/**
 * Same object, or same model identity. Reference alone is not enough: the test
 * holds the user it created, while the code under test usually re-fetches its
 * own instance of the same row.
 */
function sameNotifiable(a: Notifiable, b: Notifiable): boolean {
  if (a === b)
    return true
  const aKey = notifiableKey(a)
  const bKey = notifiableKey(b)
  return aKey !== undefined && aKey === bKey && a.constructor === b.constructor
}

function isNotificationClass(value: NotificationClass | NotificationPredicate): value is NotificationClass {
  return typeof value === 'function' && typeof (value as NotificationClass).prototype?.via === 'function'
}

function describe(match: NotificationClass | NotificationPredicate): string {
  return isNotificationClass(match) ? `[${match.name}]` : 'a matching notification'
}

/**
 * Swap the default notification manager for a recording fake; returns it.
 *
 * ```ts
 * const notifications = fakeNotifications()
 * await shipOrder(order)
 * notifications.assertSentTo(order.user, OrderShipped)
 * ```
 */
export function fakeNotifications(): NotificationFake {
  const fake = new NotificationFake()
  setDefaultNotifications(fake)
  return fake
}

/** Restore a previously-captured real manager. */
export function restoreNotifications(manager: NotificationManager): void {
  setDefaultNotifications(manager)
}
