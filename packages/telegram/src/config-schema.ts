import type { TelegramOptions } from './client'

export interface TelegramConfig extends TelegramOptions {}

/** Typed identity helper for `config/telegram.ts`. */
export function defineTelegramConfig(config: TelegramConfig): TelegramConfig {
  return config
}
