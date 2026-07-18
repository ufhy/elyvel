import type { EventKey, Listener } from '@elyvel/events'
import { EventServiceProvider as BaseEventServiceProvider } from '@elyvel/events'
import { CommentPosted } from '../events/CommentPosted'
import { SendCommentNotification } from '../listeners/SendCommentNotification'

/** App event → listener wiring (Laravel's `EventServiceProvider::$listen`). */
export class EventServiceProvider extends BaseEventServiceProvider {
  protected override listen: Array<[EventKey, Listener[]]> = [
    [CommentPosted, [new SendCommentNotification()]],
  ]
}

export default EventServiceProvider
