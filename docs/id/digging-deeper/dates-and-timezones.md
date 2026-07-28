# Tanggal & Timezone

Instance [dayjs](https://day.js.org) yang sudah dikonfigurasi adalah
objek tanggal milik framework — Carbon-nya elyvel — plus penanganan
timezone yang di-scope per-request supaya instant UTC yang sama tersimpan
tapi tampil benar untuk siapa pun yang melihatnya.

## Helper `date()`

```ts
import { date, now, today } from '@elyvel/core'

date('2026-01-15')                 // parse value apa pun yang mirip tanggal
date(user.created_at)              // bungkus Date/string/number
now()                               // momen saat ini
today()                             // 'YYYY-MM-DD' di timezone yang aktif

now().format('DD/MM/YYYY')
now().add(3, 'day')
now().fromNow()                     // gaya waktu relatif '3 days ago'
now().tz('Asia/Makassar')           // lihat di zona tertentu
```

Setiap atribut model `date`/`datetime`/timestamp sudah di-cast ke objek
yang sama ini — `post.created_at.format(...)`, `.add(...)`, `.fromNow()`
semuanya langsung bekerja tanpa perlu dibungkus lagi. Plugin (UTC,
timezone, relative-time, custom-parse-format, localized-format,
advanced-format) sudah diaktifkan sebelumnya — tidak ada yang perlu
dipasang atau diaktifkan ekstra.

`isDate(value)` memeriksa apakah sesuatu adalah salah satu objek tanggal
ini (dibanding `Date`/string mentah).

## Simpan UTC, tampilkan lokal

Semuanya *disimpan* dalam UTC (ORM melakukan ini otomatis); timezone
hanya pernah mempengaruhi *tampilan*. Timezone aktif berasal dari
`config('app.timezone')` secara default, tapi bisa dipersempit per
request — ke zona milik user yang sedang login, misalnya:

```ts
import { runWithTimezone, setRequestTimezone } from '@elyvel/core'

route().get('/dashboard', ({ user }) => {
  setRequestTimezone(user.timezone)
  // setiap pemanggilan date()/now() untuk sisa request ini kini tampil di user.timezone
})
```

`setRequestTimezone` aman dipanggil setelah `await` — di-resolve secara
concurrency-safe (`AsyncLocalStorage`), jadi request paralel tidak pernah
melihat zona satu sama lain. `runWithTimezone(tz, fn)` men-scope sebuah
timezone ke sebuah callback sebagai gantinya, untuk pekerjaan sekali pakai
di luar request (script, job).

`getAppTimezone()`/`setAppTimezone()` membaca/menulis default untuk
seluruh proses; `currentTimezone()` mengembalikan mana pun yang sedang
aktif (override request, atau default aplikasi).

## Formatting tanpa wrapper dayjs

Untuk formatter berbasis `Intl` biasa alih-alih instance dayjs penuh:

```ts
import { dateParts, formatDate, timezoneOffset, zonedStartOfDayUtc } from '@elyvel/core'

formatDate(user.created_at, { dateStyle: 'medium', timeStyle: 'short' }, 'id-ID')
// → "15 Jan 2026, 14.30" (sadar locale + timezone)

dateParts(new Date(), 'Asia/Makassar')
// → { year: '2026', month: '01', day: '15', hour: '14', minute: '30', second: '00' }

timezoneOffset('Asia/Makassar')       // offset UTC dalam menit, benar terhadap DST
zonedStartOfDayUtc('2026-01-15', 'Asia/Makassar') // instant UTC dari tengah malam lokal
```

`zonedStartOfDayUtc` adalah yang dipakai saat mengelompokkan data
berdasarkan "hari kalender di timezone user" — mengelompokkan order per
hari, misalnya — karena batas tengah-malam-UTC yang naif akan menaruh
sebagian hari di timezone user sendiri ke kelompok yang salah.
