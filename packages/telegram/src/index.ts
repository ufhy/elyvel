import { TelegramServiceProvider } from './provider'

export { TelegramClient, type TelegramMessage, type TelegramOptions } from './client'
export { defineTelegramConfig, type TelegramConfig } from './config-schema'
export { setDefaultTelegram, Telegram, telegram } from './manager'
export { TelegramServiceProvider, TelegramToken } from './provider'

/** Read by `elyvel package:discover` — see packages/core's discovery loader. */
export const elyvelProviders = [TelegramServiceProvider]
