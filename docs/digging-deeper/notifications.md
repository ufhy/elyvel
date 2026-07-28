# Notifications

Send a single notification across one or more channels — mail, an in-app
database record, Telegram — without the calling code knowing how each
channel actually delivers it.

## Defining a notification

Extend `Notification` and implement `via()` to say which channels this
notification uses; implement a `to<Channel>()` method for each one you
listed:

```ts
// app/notifications/InvoicePaid.ts
import { Notification, type Notifiable } from '@elyvel/notifications'
import { Message } from '@elyvel/mail'

export class InvoicePaid extends Notification {
  constructor(private amount: number) {
    super()
  }

  via(notifiable: Notifiable): string[] {
    return ['mail', 'database']
  }

  toMail(notifiable: Notifiable): Message {
    return new Message().subject('Invoice paid').text(`We received your payment of $${this.amount}.`)
  }

  toDatabase(notifiable: Notifiable): Record<string, unknown> {
    return { amount: this.amount }
  }
}
```

Only implement the `to*` methods for channels you actually return from
`via()` — an unimplemented one is simply skipped for that channel.

## The `Notifiable` shape

Anything can receive a notification — there's no base model class to
extend, just a plain interface:

```ts
interface Notifiable {
  routeNotificationFor?(channel: string): string | number | undefined
  getKey?(): unknown
  id?: unknown
}
```

`routeNotificationFor(channel)` supplies the per-channel address (an email
for `mail`, a chat id for `telegram`) when a notification's `toMail()` /
`toTelegram()` doesn't set one explicitly. `getKey()` (falling back to
`.id`) identifies the row for the `database` channel. A plain object literal
satisfies this just as well as an Eloquent model:

```ts
const user = {
  id: 7,
  routeNotificationFor: (channel: string) => (channel === 'mail' ? 'ada@example.com' : undefined),
}
```

## Sending notifications

```ts
import { notify } from '@elyvel/notifications'

await notify(user, new InvoicePaid(49))

// one notification, many recipients
await notify([userA, userB], new InvoicePaid(49))
```

If one channel throws, the rest still run — failures are collected and
logged (see [Testing](#testing) below) rather than aborting delivery to
every other channel. The same is true across multiple notifiables: one
recipient failing doesn't stop the others from being notified.

## Channels

| Channel | Delivers via | Notes |
| --- | --- | --- |
| `mail` | `@elyvel/mail`'s `mailManager()` | Falls back to `routeNotificationFor('mail')` if `toMail()`'s `Message` has no `to` set. |
| `telegram` | `@elyvel/telegram`'s `telegram()` | `toTelegram()` returns a string or a structured message; chat id resolved the same fallback way. |
| `database` | an app-supplied adapter | See below — needs `configureDatabaseNotifications(...)`. |
| `array` | in-memory | Test double — see [Testing](#testing). |

Register additional channels of your own with the same `Channel` interface
(`send(notifiable, notification): Promise<void>`):

```ts
import { notifications } from '@elyvel/notifications'

notifications().channel('slack', new SlackChannel())
```

There's no built-in `broadcast` channel — `toBroadcast()` is declared on
`Notification` as a stub for an app to wire up its own.

## Database notifications

The `database` channel needs an adapter that knows how to persist a
notification row:

```ts
import { configureDatabaseNotifications } from '@elyvel/notifications'

configureDatabaseNotifications({
  async insert(record) {
    await DatabaseNotification.create({
      id: record.id,
      type: record.type,
      notifiable_id: record.notifiableId,
      data: record.data,
      read_at: record.readAt,
      created_at: record.createdAt,
    })
  },
})
```

This package is deliberately DB-agnostic — there's no built-in
`notifications` table/migration, model, or `markAsRead`/`unread` query
scopes. Define the table and any read/unread querying yourself (a model
with `userstamps`-style conventions works fine); the adapter above is the
only integration point this package needs.

## Queueing

A `Notification` has no queue flag of its own — to send off the
request/response cycle, wrap the `notify()` call in something that's
already queueable: a [queue job](/digging-deeper/queues), or a
[queued event listener](/digging-deeper/events#queued-listeners):

```ts
export class SendCommentNotification extends QueuedListener<CommentPosted> {
  async handle(event: CommentPosted): Promise<void> {
    await notify({ id: event.post.userId }, new NewCommentNotification(event))
  }
}
```

## Testing

There's no `Notification::fake()`. Register the `array` channel and inspect
what it collected instead:

```ts
import { ArrayChannel, notifications } from '@elyvel/notifications'

const array = new ArrayChannel()
notifications().channel('array', array)
// ... trigger the code under test ...
array.sent // [{ notifiable, notification, data }, ...]
```

`setDefaultNotifications(manager)` swaps the process-wide default
`NotificationManager` entirely — useful for building a fresh manager with
only the channels a given test needs, rather than reconfiguring the real
one in place.

Failed sends (any channel's `send()` throwing) are recorded separately if
you opt in with `configureFailedNotifications(adapter)` — a
`MemoryFailedNotificationStore` ships by default, giving visibility into
per-channel delivery failures without a full assertion API. Read them
back with `failedNotifications()`:

```ts
import { failedNotifications } from '@elyvel/notifications'

await failedNotifications()?.all()
await failedNotifications()?.find(id)
await failedNotifications()?.forget(id)
await failedNotifications()?.flush()
await failedNotifications()?.prune(24) // older than 24 hours
```
