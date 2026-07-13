import { TelegramClient, type TelegramMessage, type TelegramOptions } from './client'

let defaultClient: TelegramClient | null = null

export function setDefaultTelegram(client: TelegramClient): void {
  defaultClient = client
}

export function telegram(): TelegramClient {
  if (!defaultClient) {
    throw new Error('[elysia-ravel] Telegram is not configured. Register TelegramServiceProvider / set a token.')
  }
  return defaultClient
}

/** The Telegram helper (mirrors the `Mail` facade). */
export const Telegram = {
  /** Send a message via the default client. */
  send(message: TelegramMessage | string): Promise<unknown> {
    return telegram().sendMessage(message)
  },
  /** Compose to a specific chat: `Telegram.to(id).message('hi')`. */
  to(chatId: string | number) {
    return {
      message(text: string, options: Omit<TelegramMessage, 'chatId' | 'text'> = {}): Promise<unknown> {
        return telegram().sendMessage({ chatId, text, ...options })
      },
    }
  },
}

export { TelegramClient, type TelegramMessage, type TelegramOptions }
