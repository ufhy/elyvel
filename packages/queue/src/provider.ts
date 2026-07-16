import type { Token } from '@elysia-ravel/core'
import type { QueueConfig } from './config-schema'
import { ServiceProvider, token } from '@elysia-ravel/core'
import { QueueManager, setDefaultQueue } from './manager'

export const QueueToken: Token<QueueManager> = token<QueueManager>('queue')

/**
 * Boots the queue from `config/queue.ts`, binds the {@link QueueManager} to
 * {@link QueueToken}, and sets it as the default used by the `dispatch()` helper.
 */
export class QueueServiceProvider extends ServiceProvider {
  override register(): void {
    const config = this.app.config.get<QueueConfig>('queue', {})
    const manager = new QueueManager(config)
    setDefaultQueue(manager)
    this.app.container.instance(QueueToken, manager)
  }
}
