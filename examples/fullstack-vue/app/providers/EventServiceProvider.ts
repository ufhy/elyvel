import type { EventKey, Listener } from '@elyvel/events'
import { EventServiceProvider as BaseEventServiceProvider } from '@elyvel/events'
import { registerListener } from '@elyvel/queue'
import { CommentPosted } from '../events/CommentPosted'
import { SendCommentNotification } from '../listeners/SendCommentNotification'

// So the queue worker can reconstruct this queued listener by class name —
// see SendCommentNotification's own doc comment.
registerListener(SendCommentNotification)

/** App event → listener wiring (Laravel's `EventServiceProvider::$listen`). */
export class EventServiceProvider extends BaseEventServiceProvider {
  protected override listen: Array<[EventKey, Listener[]]> = [
    [CommentPosted, [new SendCommentNotification()]],
  ]
}

export default EventServiceProvider
