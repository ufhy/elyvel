import type { Token } from '@elysia-ravel/core'
import { ServiceProvider, token } from '@elysia-ravel/core'
import { ArrayChannel, DatabaseChannel, MailChannel, TelegramChannel } from './channels'
import { NotificationManager, setDefaultNotifications } from './manager'

export const NotificationToken: Token<NotificationManager>
  = token<NotificationManager>('notifications')

/**
 * Boots notifications: registers the built-in channels (array/mail/telegram/
 * database), sets the default manager for `notify()`, and binds it to
 * {@link NotificationToken}. Add more channels (e.g. `broadcast`) in the app.
 */
export class NotificationServiceProvider extends ServiceProvider {
  override register(): void {
    const manager = new NotificationManager()
    manager
      .channel('array', new ArrayChannel())
      .channel('mail', new MailChannel())
      .channel('telegram', new TelegramChannel())
      .channel('database', new DatabaseChannel())
    setDefaultNotifications(manager)
    this.app.container.instance(NotificationToken, manager)
  }
}
