# Telegram

Client minimal dan bebas dependency untuk Telegram Bot API — kirim alert
dan pesan keluar dari aplikasimu, dan ini juga jadi backend channel
`telegram` milik [Notifikasi](/id/digging-deeper/notifications).

## Konfigurasi

```ts
// config/telegram.ts
import { defineTelegramConfig } from '@elyvel/telegram'

export default defineTelegramConfig({
  token: process.env.TELEGRAM_BOT_TOKEN!,
  defaultChatId: process.env.TELEGRAM_CHAT_ID,
})
```

Dapatkan `token` dari [@BotFather](https://t.me/BotFather). Jika tidak ada
token yang dikonfigurasi, package ini diam-diam tidak melakukan apa pun
saat boot — no-op sampai token diset, jadi aman untuk tidak menyertakan
`config/telegram.ts` sama sekali di environment yang tidak membutuhkannya.

## Mengirim pesan

```ts
import { Telegram, telegram } from '@elyvel/telegram'

await Telegram.send('Deploy finished ✅')                          // memakai defaultChatId
await Telegram.to(123456789).message('*Alert*', { parseMode: 'Markdown' })

await telegram().sendMessage({
  chatId: 123456789,
  text: '<b>HTML</b> alert',
  parseMode: 'HTML',
  disableNotification: true,
})
```

`sendMessage` adalah satu-satunya method level tinggi — tidak ada wrapper
`sendPhoto` atau `sendDocument`. Untuk method Bot API lainnya, pakai
escape hatch generik:

```ts
await telegram().call('sendPhoto', { chat_id: 123456789, photo: url })
```

## Ini send-only

Tidak ada webhook receiver atau polling `getUpdates` bawaan — package ini
hanya mengirim pesan, tidak menangani yang masuk. Jika kamu perlu bereaksi
terhadap pesan/command yang dikirim ke bot-mu, kamu harus menyambungkannya
sendiri (`client.call('setWebhook', ...)` plus route biasa, atau loop
polling-mu sendiri terhadap `getUpdates`).

## Integrasi notifikasi

Channel `telegram` milik `@elyvel/notifications` memanggil `sendMessage`
yang sama di baliknya — `toTelegram()` sebuah notifikasi mengembalikan
string biasa atau bentuk `TelegramMessage` yang sama seperti di atas, dan
chat id jatuh ke `notifiable.routeNotificationFor('telegram')` jika
pesannya tidak menentukan satu pun. Lihat
[Notifikasi](/id/digging-deeper/notifications#channel).

## Penanganan error

Request yang gagal — token salah, chat id tidak valid, atau rate limit
milik Telegram sendiri — melempar `Error` dengan deskripsi dari Telegram
tertanam di dalamnya (misal `Unauthorized`, `Too Many Requests: retry
after N`). Tidak ada retry/backoff otomatis; tangkap sendiri jika
kegagalan tidak boleh menyebar. Memanggil `sendMessage` tanpa `chatId` dan
tanpa `defaultChatId` yang dikonfigurasi throw sebelum request apa pun
dibuat.

## Testing

Tidak ada fake client bawaan. Arahkan `TelegramClient` sungguhan ke
instance `Bun.serve` lokal yang berperan sebagai Bot API sebagai
gantinya:

```ts
const server = Bun.serve({
  port: 0,
  fetch: async (req) => Response.json({ ok: true, result: {} }),
})

const client = new TelegramClient({ token: 'test', apiBase: `http://localhost:${server.port}` })
await client.sendMessage({ chatId: 1, text: 'hi' })
```

Supaya kode yang memanggil facade `Telegram`/`telegram()` (alih-alih
menyimpan instance client-nya sendiri) memakai fake ini, tukar sebagai
default proses:

```ts
import { setDefaultTelegram } from '@elyvel/telegram'

setDefaultTelegram(client)
```

`apiBase` adalah opsi constructor kelas satu khusus untuk ini.
