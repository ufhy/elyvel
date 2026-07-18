import type { Token } from '@elyvel/core'
import type { MailConfig } from './config-schema'
import { ServiceProvider, token } from '@elyvel/core'
import { MailManager, setDefaultMailer } from './manager'

export const MailToken: Token<MailManager> = token<MailManager>('mail')

/**
 * Boots mail from `config/mail.ts`, binds the {@link MailManager} to
 * {@link MailToken}, and sets it as the default used by the `Mail`/`mail()` helpers.
 */
export class MailServiceProvider extends ServiceProvider {
  override register(): void {
    const config = this.app.config.get<MailConfig>('mail', {})
    const manager = new MailManager(config)
    setDefaultMailer(manager)
    this.app.container.instance(MailToken, manager)
  }
}
