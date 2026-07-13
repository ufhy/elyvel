import { defineTelegramConfig } from '@elysia-ravel/telegram'

/**
 * Telegram bot config. Set TELEGRAM_BOT_TOKEN (from @BotFather) to enable it;
 * without a token the provider stays inert. Send with `Telegram.to(chatId).message(...)`.
 */
export default defineTelegramConfig({
  token: process.env.TELEGRAM_BOT_TOKEN ?? '',
  defaultChatId: process.env.TELEGRAM_CHAT_ID,
})
