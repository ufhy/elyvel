# Telegram

A minimal, dependency-free client for the Telegram Bot API — send outbound
alerts and messages from your app, and it also backs
[Notifications](/digging-deeper/notifications)' `telegram` channel.

## Configuration

```ts
// config/telegram.ts
import { defineTelegramConfig } from '@elyvel/telegram'

export default defineTelegramConfig({
  token: process.env.TELEGRAM_BOT_TOKEN!,
  defaultChatId: process.env.TELEGRAM_CHAT_ID,
})
```

Get a `token` from [@BotFather](https://t.me/BotFather). If no token is
configured, the package silently does nothing at boot — it's a no-op until
one is set, so it's safe to leave `config/telegram.ts` out entirely in
environments that don't need it.

## Sending messages

```ts
import { Telegram, telegram } from '@elyvel/telegram'

await Telegram.send('Deploy finished ✅')                          // uses defaultChatId
await Telegram.to(123456789).message('*Alert*', { parseMode: 'Markdown' })

await telegram().sendMessage({
  chatId: 123456789,
  text: '<b>HTML</b> alert',
  parseMode: 'HTML',
  disableNotification: true,
})
```

`sendMessage` is the only high-level method — there's no `sendPhoto` or
`sendDocument` wrapper. For any other Bot API method, use the generic
escape hatch:

```ts
await telegram().call('sendPhoto', { chat_id: 123456789, photo: url })
```

## This is send-only

There's no webhook receiver or `getUpdates` polling built in — this
package only sends messages, it doesn't handle incoming ones. If you need
to react to messages/commands sent to your bot, you'd wire that yourself
(`client.call('setWebhook', ...)` plus a plain route, or your own polling
loop against `getUpdates`).

## Notifications integration

`@elyvel/notifications`' `telegram` channel calls the same `sendMessage`
underneath — a notification's `toTelegram()` returns a plain string or the
same `TelegramMessage` shape shown above, and the chat id falls back to
`notifiable.routeNotificationFor('telegram')` if the message doesn't
specify one. See [Notifications](/digging-deeper/notifications#channels).

## Error handling

A failed request — bad token, invalid chat id, or Telegram's own rate
limit — throws an `Error` with Telegram's own description embedded (e.g.
`Unauthorized`, `Too Many Requests: retry after N`). There's no automatic
retry/backoff; catch it yourself if a failure shouldn't propagate. Calling
`sendMessage` with no `chatId` and no `defaultChatId` configured throws
before any request is made.

## Testing

There's no shipped fake client. Point a real `TelegramClient` at a local
`Bun.serve` instance standing in for the Bot API instead:

```ts
const server = Bun.serve({
  port: 0,
  fetch: async (req) => Response.json({ ok: true, result: {} }),
})

const client = new TelegramClient({ token: 'test', apiBase: `http://localhost:${server.port}` })
await client.sendMessage({ chatId: 1, text: 'hi' })
```

To make code that calls the `Telegram`/`telegram()` facade (rather than
holding its own client instance) use this fake, swap it in as the process
default:

```ts
import { setDefaultTelegram } from '@elyvel/telegram'

setDefaultTelegram(client)
```

`apiBase` is a first-class constructor option specifically for this.
