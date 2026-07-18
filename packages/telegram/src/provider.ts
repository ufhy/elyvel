import type { Token } from '@elyvel/core'
import type { TelegramConfig } from './config-schema'
import { ServiceProvider, token } from '@elyvel/core'
import { TelegramClient } from './client'
import { setDefaultTelegram } from './manager'

export const TelegramToken: Token<TelegramClient> = token<TelegramClient>('telegram')

/**
 * Boots Telegram from `config/telegram.ts`, binds the {@link TelegramClient} to
 * {@link TelegramToken}, and sets it as the default used by the `Telegram` helper.
 * Skips setup when no token is configured.
 */
export class TelegramServiceProvider extends ServiceProvider {
  override register(): void {
    const config = this.app.config.get<TelegramConfig | undefined>('telegram')
    if (!config?.token)
      return
    const client = new TelegramClient(config)
    setDefaultTelegram(client)
    this.app.container.instance(TelegramToken, client)
  }
}
