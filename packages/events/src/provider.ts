import { ServiceProvider, type Token, token } from '@elysia-ravel/core'
import { Dispatcher, type EventKey, type Listener, setDefaultDispatcher } from './dispatcher'

export const DispatcherToken: Token<Dispatcher> = token<Dispatcher>('events')

/**
 * Base event service provider. Subclass it and set `listen` (event → listeners)
 * to register application listeners at boot, à la Laravel's EventServiceProvider.
 * Binds the {@link Dispatcher} to {@link DispatcherToken} and sets it as default.
 */
export class EventServiceProvider extends ServiceProvider {
  /** Map of event class/name → listeners to register. */
  protected listen: Array<[EventKey, Listener[]]> = []

  override register(): void {
    const dispatcher = new Dispatcher()
    for (const [event, listeners] of this.listen) {
      for (const listener of listeners) dispatcher.listen(event, listener)
    }
    setDefaultDispatcher(dispatcher)
    this.app.container.instance(DispatcherToken, dispatcher)
  }
}
