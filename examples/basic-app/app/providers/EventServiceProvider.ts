import { EventServiceProvider as BaseEventServiceProvider, type EventKey, type Listener } from '@elysia-ravel/events'
import { UserRegistered } from '../events/UserRegistered'

/** Register application event listeners here (à la Laravel's EventServiceProvider). */
export class EventServiceProvider extends BaseEventServiceProvider {
  protected override listen: Array<[EventKey, Listener[]]> = [
    [
      UserRegistered,
      [
        (event: UserRegistered) => {
          // In a real app: send an email, enqueue a job, etc.
          console.log(`[event] welcome ${event.email}`)
        },
      ],
    ],
    // Eloquent model events flow through the dispatcher too (bridged in
    // AppServiceProvider). Observe any model's lifecycle by name:
    [
      'eloquent.created: User',
      [(user) => console.log(`[event] user created #${(user as { id: number }).id}`)],
    ],
  ]
}
