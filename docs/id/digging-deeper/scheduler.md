# Task Scheduling

Definisikan jadwal cron aplikasimu sebagai kode, di satu tempat, alih-alih
menyebar entri `crontab` di berbagai server. Satu entri system cron (atau
satu command dev) menjalankan semuanya.

## Mendefinisikan jadwal

Override `schedule()` di subclass `ScheduleServiceProvider`:

```ts
// app/providers/ScheduleServiceProvider.ts
import type { Schedule } from '@elyvel/scheduler'
import { ScheduleServiceProvider as BaseScheduleServiceProvider } from '@elyvel/scheduler'

export class ScheduleServiceProvider extends BaseScheduleServiceProvider {
  protected override schedule(schedule: Schedule): void {
    schedule
      .call(() => Post.publishDue())
      .named('publish-scheduled-posts')
      .everyMinute()

    schedule
      .command('model:prune')
      .named('prune-models')
      .daily()
  }
}
```

Daftarkan seperti provider lainnya di `config/app.ts`. Setiap pendaftaran
mengembalikan `ScheduledEvent` yang bisa dirangkai untuk mengatur frekuensi
dan constraint apa pun.

Method frekuensi: `everyMinute()`, `everyTwoMinutes()`,
`everyFiveMinutes()`, `everyTenMinutes()`, `everyFifteenMinutes()`,
`everyThirtyMinutes()`, `hourly()`, `hourlyAt(minute)`, `daily()`,
`dailyAt('HH:MM')`, `twiceDaily(first?, second?)`, `weekly()`,
`weeklyOn(day, time?)`, `monthly()`, `monthlyOn(day?, time?)`,
`quarterly()`, `yearly()`, filter hari-dalam-minggu (`weekdays()`,
`weekends()`, `sundays()`…`saturdays()`, `days(...)`), dan cron mentah
`cron('* * * * *')`. Frekuensi sub-menit (`everySecond()`,
`everyFiveSeconds()`, ...) hanya berlaku di bawah `schedule:work`, bukan
`schedule:run` yang sekali semenit.

## Tipe task

```ts
schedule.call(() => cleanupTempFiles())        // closure
schedule.exec('convert input.jpg output.webp') // perintah shell mentah
schedule.command('cache:prune-stale-tags')     // command CLI `elyvel`
schedule.job(new GenerateReportJob())          // menjalankan handle() inline, sinkron
```

`job(...)` menjalankan `handle()` job langsung, bukan lewat queue — untuk
eksekusi background/queued sebagai gantinya, jadwalkan closure yang
men-dispatch-nya:

```ts
schedule.call(() => dispatch(new GenerateReportJob('scheduled-report'))).everyMinute()
```

## Constraint

```ts
schedule.call(sendDigest).daily()
  .when(() => featureEnabled('digest'))
  .environments('production')
  .timezone('Asia/Jakarta')
  .between('08:00', '18:00') // hanya berjalan dalam window ini (mendukung rentang overnight juga)
```

`when(fn)` berjalan hanya jika `fn()` truthy; `skip(fn)` kebalikannya.
`environments(...)` membatasi ke nilai `app.env` tertentu. `timezone(tz)`
(zona IANA) berlaku untuk evaluasi cron dan pengecekan window waktu mana
pun.

## Mencegah tumpang tindih

```ts
schedule.call(longRunningReport).hourly().withoutOverlapping(120) // lock kedaluwarsa setelah 120 menit
schedule.call(cleanup).daily().onOneServer()  // hanya satu instance yang menjalankannya
schedule.call(pingHealthcheck).everyMinute().runInBackground() // tidak memblokir sisa jadwal
```

`withoutOverlapping()` dan `onOneServer()` per-proses (in-memory) secara
default — cukup untuk satu instance, tapi hanya jaminan no-op lintas
beberapa instance sampai kamu menyambungkan mutex bersama:

```ts
import { configureScheduleMutex, RedisScheduleMutex } from '@elyvel/scheduler'

configureScheduleMutex(new RedisScheduleMutex(redisClient))
```

`runInBackground()` menjalankan task tanpa menunggunya, jadi task yang
lambat tidak menunda sisa jadwal tick tersebut — hook `onFailure`-nya (dan
failure logger di bawah) tetap terpicu jika ia throw.

## Hook sukses & gagal

```ts
schedule.call(syncInventory).hourly()
  .onSuccess(() => metrics.increment('inventory.synced'))
  .onFailure(error => alertOncall(error))
  .thenPing('https://healthchecks.io/ping/xyz')
```

Tersedia juga: `before(fn)`/`after(fn)` (berjalan apa pun hasilnya),
`pingBefore(url)`/`pingOnSuccess(url)`/`pingOnFailure(url)`, dan capture
output (`sendOutputTo(path)`, `appendOutputTo(path)`,
`emailOutputTo(address)`).

Terlepas dari `.onFailure()` apa pun yang kamu tulis, setiap kegagalan task
— termasuk task `runInBackground()` yang error-nya tidak pernah sampai ke
output CLI itu sendiri — otomatis dicatat ke channel `scheduler`, sehingga
cron job yang gagal secara diam-diam tetap meninggalkan jejak. Lihat
[Logging](/id/digging-deeper/logging).

## Menjalankan scheduler

```bash
elyvel schedule:run      # jalankan semua yang due sekarang — panggil ini setiap menit dari system cron
elyvel schedule:work     # loop long-running, tick setiap detik — tidak butuh system cron untuk dev lokal
elyvel schedule:test     # jalankan setiap task sekarang juga, mengabaikan ekspresi cron-nya
elyvel schedule:test publish-scheduled-posts   # jalankan satu task tertentu berdasarkan nama
elyvel schedule:list     # cetak ekspresi cron, nama, dan timezone setiap task
```

Setup production cukup satu baris crontab:

```
* * * * * cd /path/to/app && elyvel schedule:run >> /dev/null 2>&1
```

::: warning Belum ada gate maintenance mode
Berbeda dari Laravel, scheduled task di sini tidak otomatis dilewati saat
aplikasi dalam maintenance mode — tidak ada escape hatch
`evenInMaintenanceMode()` karena tidak ada gate yang perlu di-escape. Jika
sebuah task tidak boleh berjalan saat maintenance, jaga secara eksplisit
dengan `.when(() => !isDownForMaintenance())`.
:::

## Testing

```ts
const event = new ScheduledEvent(() => {}).cron('0 8 * * *').timezone('UTC')

event.isDue(someDate)              // hanya kecocokan cron
await event.shouldRun(someDate)    // cron + environment + when/skip
```

Untuk run lengkap, buat `Schedule`, daftarkan task, dan panggil
`schedule.run(fixedDate)` — ia mengembalikan satu `{ name, expression, ran, error? }`
per task yang due (`ran: false` berarti due tapi dilewati oleh lock
overlap), memungkinkanmu meng-assert logika penjadwalan dan efek samping
sesungguhnya dari task sekaligus.
