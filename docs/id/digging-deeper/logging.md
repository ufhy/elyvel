# Logging

Logging terstruktur dan berjenjang dengan transport yang bisa diganti-ganti
— console untuk dev, file yang berotasi di production, semuanya lewat API
kecil yang sama. Setiap HTTP request otomatis di-log dengan correlation id,
dan field sensitif diredaksi sebelum sampai ke sink mana pun.

## Konfigurasi

Bentuk sederhana tidak butuh `channels` sama sekali — console plus satu
file rotasi opsional:

```ts
// config/logging.ts
import { defineLoggingConfig } from '@elyvel/core'

export default defineLoggingConfig({
  level: process.env.LOG_LEVEL ?? 'info',
  pretty: process.env.NODE_ENV !== 'production',
  file: 'storage/logs/app.log',
  maxBytes: 5 * 1024 * 1024,
  maxFiles: 5,
})
```

Untuk kontrol lebih, definisikan channel bernama dan gabungkan jadi
`stack` (konsep stacked-channel milik Laravel):

```ts
export default defineLoggingConfig({
  default: 'stack',
  channels: {
    console: { driver: 'console' },
    daily: { driver: 'daily', path: 'storage/logs/app', maxDays: 30 },
    stack: { driver: 'stack', channels: ['console', 'daily'] },
  },
})
```

`app.logger` adalah channel default (atau stack); `app.channel('daily')`
me-resolve channel tertentu. `http: false` mematikan logging otomatis
per-request yang dijelaskan di bawah.

## Level log

Skala 4-tier bergaya pino yang sengaja dibuat kecil — `debug` < `info` <
`warn` < `error` — plus `silent` sebagai floor khusus config yang
membungkam semuanya. Ini sengaja lebih sederhana dari 8 level milik
Monolog; tidak ada pembedaan `emergency`/`alert`/`critical`/`notice`.

## Menulis log

```ts
import { createLogger } from '@elyvel/core'

const log = createLogger({ level: 'info' })

log.debug('cache miss', { key })
log.info('user signed up', { userId: user.id })
log.warn('slow query', { ms: 480 })
log.error('payment failed', { orderId, error })

// level dipilih saat runtime
log.log('info', 'checkout started', { cartId })
```

Beri scope pada logger dengan sebuah nama — entri jadi ditandai supaya
bisa difilter per subsistem:

```ts
const sql = log.child('sql')
sql.error('query failed', { sql: text, bindings, error })
```

Bind konteks yang harus ikut di setiap pemanggilan berikutnya, alih-alih
mengulanginya di setiap call site:

```ts
const requestLog = log.withContext({ requestId })
requestLog.info('processing') // requestId otomatis ikut
```

## Transport

| Transport | Perilaku |
| --- | --- |
| `console` | Pretty (berwarna, mudah dibaca manusia) atau JSON per baris; `error`/`warn` ke `console.error`. |
| `file` | Penulisan sinkron, rotasi berbasis ukuran (`maxBytes`/`maxFiles`), gzip opsional. |
| `file` + `buffered: true` | Mem-batch penulisan (`flushEvery`/`intervalMs`) jadi lebih sedikit syscall; flush saat exit/`SIGINT`/`SIGTERM`. |
| `daily` | Satu file per hari kalender (`<path>-YYYY-MM-DD.log`), memangkas file lebih tua dari `maxDays`. |

Masing-masing adalah class konkret yang bisa di-import
(`ConsoleTransport`, `FileTransport`, `DailyFileTransport`,
`BufferedFileTransport`) yang mengimplementasikan interface `Transport`
kecil (`log(entry)`) — jalur berbasis config di atas membangun salah
satunya untukmu, tapi membuat satu secara langsung berguna di luar
aplikasi penuh (script standalone, setup multi-tujuan custom):

```ts
import { FileTransport, Logger } from '@elyvel/core'

const log = new Logger({ transports: [new FileTransport('storage/logs/app.log', { compress: true })] })
```

## Redaksi

Daftar key redaksi dan pola value default juga di-export, jika kamu ingin
memperluas alih-alih mengganti:

```ts
import { DEFAULT_REDACT, REDACT_PATTERNS } from '@elyvel/core'

createLogger({ redact: [...DEFAULT_REDACT, 'ssn'], redactPatterns: [REDACT_PATTERNS.creditCard] })
```

Field sensitif otomatis dibersihkan sebelum entri sampai ke transport mana
pun — tidak perlu opt-in per call site. Key yang cocok dengan `password`,
`token`, `authorization`, `secret`, `cookie`, `accessToken`,
`refreshToken`, `apiKey` (tanpa memandang huruf besar/kecil) diganti
`[REDACTED]`, secara rekursif melalui object dan array bersarang. Dua pola
value opsional menangkap secret yang tertanam di teks bebas: rangkaian
digit mirip kartu kredit, dan `Bearer <token>`.

```ts
log.info('login attempt', { email, password: 'hunter2' })
// → { email: '...', password: '[REDACTED]' }
```

Kustomisasi daftar key atau pola per logger (`createLogger({ redact, redactPatterns })`)
atau untuk seluruh aplikasi (`logging.redact`/`redactPatterns`/`redactJson`
di `config/logging.ts`). Nilai `Date`/`RegExp`/`Map`/`Set`/`Error`/typed
array dilewati apa adanya alih-alih diratakan.

## Correlation id & logging HTTP otomatis

Setiap request mendapat UUID tepat saat masuk, dan `log` yang sudah
ter-bind ke id itu tersedia di handler atau middleware mana pun — setiap
entri yang di-log lewatnya otomatis membawa id request tersebut:

```ts
route().post('/orders', ({ log, body }) => {
  log.info('creating order', { total: body.total }) // requestId otomatis ikut
})
```

Response itu sendiri di-log saat keluar — `debug` untuk 2xx/3xx yang
bersih, `warn` untuk 4xx, `error` untuk 5xx — dengan `{ requestId, status,
ms, userId? }`. Error 5xx yang tidak tertangani mendapat entri sendiri
dengan stack trace. Set `http: false` di `config/logging.ts` untuk
mematikan ini.

## Logging lintas package

Package lain otomatis mencatat ke channel bernama miliknya sendiri saat
tersambung. Dua contoh: `EloquentServiceProvider` milik `@elyvel/database`
mencatat setiap error query ke channel `sql` (dan setiap query di level
`debug` jika `database.log: true`); `@elyvel/scheduler` mencatat setiap
kegagalan scheduled task — termasuk task background tanpa
`.onFailure()` eksplisit — ke channel `scheduler`, sehingga cron job yang
gagal secara diam-diam tetap meninggalkan jejak.

## Testing

Suntikkan transport palsu untuk menangkap dan meng-assert entri secara
langsung, alih-alih mem-parsing output console/file:

```ts
import { Logger, type LogEntry } from '@elyvel/core'

const entries: LogEntry[] = []
const log = new Logger({ transports: [{ log: e => entries.push(e) }] })

log.error('boom', { userId: 1 })

expect(entries[0].message).toBe('boom')
expect(entries[0].context).toEqual({ userId: 1 })
```
