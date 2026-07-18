export interface TelegramOptions {
  /** Bot token from @BotFather. */
  token: string
  /** API base URL. Override for a local test server. Default `https://api.telegram.org`. */
  apiBase?: string
  /** Default chat id used when a message omits one. */
  defaultChatId?: string | number
}

export interface TelegramMessage {
  chatId?: string | number
  text: string
  parseMode?: 'HTML' | 'MarkdownV2' | 'Markdown'
  disableNotification?: boolean
  disableWebPagePreview?: boolean
  replyMarkup?: unknown
}

/** A thin, typed Telegram Bot API client (uses fetch — works on Bun out of the box). */
export class TelegramClient {
  constructor(private readonly options: TelegramOptions) {}

  private url(method: string): string {
    return `${(this.options.apiBase ?? 'https://api.telegram.org').replace(/\/$/, '')}/bot${this.options.token}/${method}`
  }

  /** Call any Bot API method with raw params. */
  async call<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    const res = await fetch(this.url(method), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    })
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      description?: string
      result?: T
    }
    if (!res.ok || data.ok === false) {
      throw new Error(`[elyvel] Telegram ${method} failed: ${data.description ?? res.status}`)
    }
    return data.result as T
  }

  /** Send a text message (Laravel-style: a string or a full message object). */
  async sendMessage(message: TelegramMessage | string): Promise<unknown> {
    const m: TelegramMessage = typeof message === 'string' ? { text: message } : message
    const chatId = m.chatId ?? this.options.defaultChatId
    if (chatId === undefined) {
      throw new Error(
        '[elyvel] Telegram sendMessage needs a chatId (or config.defaultChatId).',
      )
    }
    return this.call('sendMessage', {
      chat_id: chatId,
      text: m.text,
      parse_mode: m.parseMode,
      disable_notification: m.disableNotification,
      disable_web_page_preview: m.disableWebPagePreview,
      reply_markup: m.replyMarkup,
    })
  }
}
