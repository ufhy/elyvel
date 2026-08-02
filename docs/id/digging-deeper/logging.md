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

Biarkan `pretty` kosong dan console jadi mudah dibaca sementara file jadi
JSON, di **semua** environment — logger tidak membaca `APP_ENV`. File log
hidup lebih lama dari environment yang menulisnya, dan file yang memuat dua
format adalah file yang salah dibaca; teks pretty juga membuang context
terstruktur yang membuat entri bisa difilter. Kalau tetap ingin mengikuti
environment, tulis di sini supaya terlihat:
`pretty: process.env.APP_ENV !== 'production'` — berlaku untuk keduanya.

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

## Channel

Sink bernama, dipilih lewat `default` — bentuknya sama dengan
`config/logging.php` milik Laravel. Framework hanya membaca config; file hasil
scaffold-lah yang membaca environment, lewat variabel `LOG_*`:

```ts
// config/logging.ts
export default defineLoggingConfig({
  default: process.env.LOG_CHANNEL ?? 'stack',
  channels: {
    stack: { driver: 'stack', channels: (process.env.LOG_STACK ?? 'console,single').split(',') },
    console: { driver: 'console' },
    single: { driver: 'file', path: 'storage/logs/app.log', maxBytes: 5 * 1024 * 1024, maxFiles: 5 },
    daily: { driver: 'daily', path: 'storage/logs/app.log', maxDays: 14 },
    null: { driver: 'null' },
  },
})
```

Akses channel tertentu dengan `app.channel('daily')`; `app.logger` memakai
`default`. Driver: `console`, `file`, `daily`, `stack`, dan `null`.

`null` menerima tulisan lalu membuangnya — channel NullHandler milik Laravel.
Itulah cara `LOG_CHANNEL=null` membungkam logging tanpa menghapus konfigurasi
yang mencatat ke mana log seharusnya pergi, dan ia bisa diletakkan di dalam stack.

### Saat penulisan log gagal

Transport bisa gagal: disk penuh, permission berubah, sink remote hilang. Secara
default kegagalan itu diteruskan ke pemanggil — sama dengan default Laravel
(`ignore_exceptions`). Itu default yang tepat untuk sink yang tidak boleh hilang:
request yang tidak bisa dicatat di audit trail biasanya request yang tidak
seharusnya diam-diam berhasil.

Setel di stack untuk menelan kegagalan dan melaporkannya ke stderr:

```ts
stack: { driver: 'stack', channels: ['console', 'single'], ignoreExceptions: true },
```

Logger turunan (`log.child('http')`, `withContext(...)`) mewarisi setelan ini,
jadi logger per-request tidak pernah berperilaku beda dari induknya.

### Logger dadakan

Logger yang dideskripsikan di tempat ia dipakai, bukan di `config/logging.ts` —
`Log::build()` dan `Log::stack()` milik Laravel:

```ts
// Sink untuk satu job, hilang begitu referensinya dilepas. Tidak didaftarkan.
app.log.build({ driver: 'file', path: `storage/logs/import-${jobId}.log` })
  .info('started', { rows })

// Satu tulisan, beberapa channel yang sudah ada.
app.log.stack(['single', 'daily']).critical('provider unreachable')
```

`build()` mewarisi level dan konfigurasi redaction milik app, jadi file dadakan
tidak bisa membocorkan apa yang di channel biasa akan disensor.

## Level log

Delapan severity RFC 5424 yang didefinisikan PSR-3 — himpunan yang sama dengan
Laravel:

`debug` < `info` < `notice` < `warning` < `error` < `critical` < `alert` <
`emergency`

plus `silent` sebagai floor khusus config yang membungkam semuanya. Masing-masing
punya method — `log.critical(...)`, `log.emergency(...)` — dan `level` di config
adalah ambang, jadi `level: 'warning'` menyimpan semua dari `warning` ke atas.

`warn()` tetap ada sebagai ejaan lain dari `warning()`: dulu itu satu-satunya
ejaan di framework ini. Entri selalu **disimpan** sebagai `warning`, sehingga
filter dan log viewer tidak perlu mencocokkan dua nama untuk satu level.

Semua yang `warning` ke atas ditulis ke stderr, sisanya ke stdout.

## Menulis log

```ts
import { createLogger } from '@elyvel/core'

const log = createLogger({ level: 'info' })

log.debug('cache miss', { key })
log.info('user signed up', { userId: user.id })
log.warning('slow query', { ms: 480 })
log.error('payment failed', { orderId, error })
log.critical('payment provider unreachable', { provider })
log.emergency('no database connection available')

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
