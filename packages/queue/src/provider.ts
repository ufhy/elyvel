import type { Token } from '@elyvel/core'
import type { QueueConfig } from './config-schema'
import { ServiceProvider, token } from '@elyvel/core'
import { configureListenerQueuer } from '@elyvel/events'
import { queueListener } from './listener-job'
import { QueueManager, setDefaultQueue } from './manager'

export const QueueToken: Token<QueueManager> = token<QueueManager>('queue')

/**
 * Boots the queue from `config/queue.ts`, binds the {@link QueueManager} to
 * {@link QueueToken}, and sets it as the default used by the `dispatch()` helper.
 * Also wires `@elyvel/events`' `QueuedListener` to actually push onto this
 * queue — without this, a listener extending `QueuedListener` would run inline
 * with no queuer configured to catch it.
 */
export class QueueServiceProvider extends ServiceProvider {
  override register(): void {
    const config = this.app.config.get<QueueConfig>('queue', {})
    const manager = new QueueManager(config)
    setDefaultQueue(manager)
    this.app.container.instance(QueueToken, manager)
    configureListenerQueuer(queueListener)
  }
}
