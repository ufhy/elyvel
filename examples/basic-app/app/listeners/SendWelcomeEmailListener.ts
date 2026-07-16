import type { UserRegistered } from '../events/UserRegistered'
import { QueuedListener } from '@elysia-ravel/events'

/**
 * A queued event listener (Laravel's `implements ShouldQueue`). Extending
 * QueuedListener means that when `UserRegistered` is dispatched, this listener
 * is pushed onto the queue instead of running inline — the worker runs `handle`.
 * Register it (registerListener) + wire the queuer (configureListenerQueuer) in
 * AppServiceProvider; attach it to the event in EventServiceProvider.
 */
export class SendWelcomeEmailListener extends QueuedListener<UserRegistered> {
  /** Run it on the `mail` queue (falls back to default if not defined). */
  viaQueue = () => 'default'

  async handle(event: UserRegistered): Promise<void> {
    // Slow work (send an email, hit an API) — off the request path, on the worker.
    console.log(`[queued-listener] sending welcome email to ${event.email}`)
  }

  failed(event: UserRegistered, error: unknown): void {
    console.error(`[queued-listener] welcome email failed for ${event.email}: ${String(error)}`)
  }
}
