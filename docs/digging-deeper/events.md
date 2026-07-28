# Events

A simple observer pattern: dispatch an event, and every listener registered
for it runs. Useful for decoupling side effects (send a notification, bust a
cache, log an audit trail) from the code that triggers them.

## Defining events

There's no base class or decorator to extend — any plain class is an event.
Its constructor name is the dispatch key, and its public fields are the
payload listeners receive:

```ts
// app/events/CommentPosted.ts
export class CommentPosted {
  constructor(
    public readonly comment: Comment,
    public readonly post: Post,
  ) {}
}
```

## Registering listeners

A listener is a plain function, or an object/class with a `handle(event,
name)` method:

```ts
import { listen } from '@elyvel/events'

listen(CommentPosted, (event) => {
  console.log(`New comment on post ${event.post.id}`)
})
```

Listeners for the same event run in registration order; returning `false`
from one stops the rest from running for that dispatch. A wildcard listener
(key `'*'`) fires for every event and also receives its resolved name:

```ts
listen('*', (event, name) => console.log(`fired: ${name}`))
```

String-named events work too, for ad-hoc signals that don't need a class:

```ts
listen('cache.cleared', payload => console.log(payload))
```

## Dispatching events

```ts
import { event } from '@elyvel/events'

await event(new CommentPosted(comment, post))
await event('cache.cleared', { store: 'redis' })
```

`event()` returns every listener's return value as an array (skipping
null/undefined ones) — handy when a listener computes something the
dispatch site wants back. `Dispatcher.until(event)` runs listeners in order
and returns as soon as one returns a non-null value, short-circuiting the
rest — Laravel's equivalent for "first listener that answers wins".

## The `EventServiceProvider`

Register every event → listener mapping in one place, at boot:

```ts
// app/providers/EventServiceProvider.ts
import type { EventKey, Listener } from '@elyvel/events'
import { EventServiceProvider as BaseEventServiceProvider } from '@elyvel/events'
import { CommentPosted } from '../events/CommentPosted'
import { SendCommentNotification } from '../listeners/SendCommentNotification'

export class EventServiceProvider extends BaseEventServiceProvider {
  protected override listen: Array<[EventKey, Listener[]]> = [
    [CommentPosted, [new SendCommentNotification()]],
  ]
}
```

Add it to `providers` in `config/app.ts` like any other service provider.

## Event subscribers

For a class that wants to register several related listeners at once instead
of listing them all in `EventServiceProvider`, implement `Subscriber`:

```ts
import type { Dispatcher, Subscriber } from '@elyvel/events'

class AuditSubscriber implements Subscriber {
  subscribe(dispatcher: Dispatcher): void {
    dispatcher.listen(UserRegistered, e => audit('user.registered', e))
    dispatcher.listen(UserDeleted, e => audit('user.deleted', e))
  }
}

dispatcher.subscribe(new AuditSubscriber())
```

## Queued listeners

A listener that shouldn't block the request (sending a notification,
calling a slow API) extends `QueuedListener` instead of being a plain
object — this is the queue opt-in, Laravel's `ShouldQueue`:

```ts
// app/listeners/SendCommentNotification.ts
import { QueuedListener } from '@elyvel/events'

export class SendCommentNotification extends QueuedListener<CommentPosted> {
  async handle(event: CommentPosted): Promise<void> {
    await notify({ id: event.post.user_id }, new NewCommentNotification(event))
  }
}
```

Register the class with `@elyvel/queue`'s `registerListener(...)` (alongside
your `registerJob(...)` calls) so the worker — a separate process — can
reconstruct it from the serialized job:

```ts
import { registerListener } from '@elyvel/queue'

registerListener(SendCommentNotification)
```

Optional hooks on a `QueuedListener`: `shouldQueue(event)` (return `false` to
run inline for this particular event instead), `viaConnection()`,
`viaQueue()`, `withDelay(event)`, and `failed(event, error)`. Extend
`QueuedListenerAfterCommit` instead to defer queueing until an enclosing
database transaction commits. Without `@elyvel/queue` installed and wired
(it calls `configureListenerQueuer` at boot), a `QueuedListener` just runs
inline — nothing breaks, it simply isn't deferred.

## Deferring a plain event until commit

`QueuedListenerAfterCommit` above defers the *listener*; a plain event (no
queue involved at all) can defer its own dispatch the same way by setting
`dispatchAfterCommit = true` — useful so listeners never see an event for a
row that a rolled-back transaction ends up undoing:

```ts
export class OrderPlaced {
  readonly dispatchAfterCommit = true
  constructor(public order: Order) {}
}
```

This needs one wiring call at boot, bridging to `@elyvel/database`'s own
`afterCommit`:

```ts
import { afterCommit } from '@elyvel/database'
import { configureEventAfterCommit } from '@elyvel/events'

configureEventAfterCommit(callback => afterCommit(callback))
```

Without it, `dispatchAfterCommit` is silently ignored and the event
dispatches immediately, same as any other event.

## Testing

Swap in a recording dispatcher so dispatched events don't actually run their
listeners, and assert on what *would* have fired:

```ts
import { fakeEvents, restoreEvents } from '@elyvel/events'

const fake = fakeEvents()
await someAction()
fake.assertDispatched(CommentPosted)
fake.assertNotDispatched(UserDeleted)
restoreEvents() // back to the real dispatcher
```

## Model events

Eloquent model lifecycle hooks (`creating`/`created`/`updating`/`saved`/
`deleting`/`deleted`/...) are a separate, self-contained mechanism — see
[Eloquent: Getting Started](/database/eloquent) and `Model.observe()`. They
don't go through this dispatcher by default, though an app can bridge them
in with `configureModelEventDispatcher(...)` if it wants model lifecycle
changes to also fire as regular events.
