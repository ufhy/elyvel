# Rate Limiting

Rate limiter bernama dan bisa dipakai berulang — berbasis cache, bekerja
baik sebagai middleware request maupun sebagai pemanggilan fungsi biasa
untuk membatasi logika apa pun (pengiriman SMS, job yang mahal) di luar
siklus request/response.

Halaman ini lebih dalam dari sekilas yang sudah ada di
[Middleware](/id/basics/middleware#rate-limiting) — abstraksi store,
urutan multi-limit, header response, dan catatan soal `.after()`.

## Mendefinisikan limiter bernama

```ts
import { Limit, RateLimiter } from '@elyvel/core'

RateLimiter.for('api', () => Limit.perMinute(60))

RateLimiter.for('login', ctx => [
  Limit.perMinute(5), // batas global untuk route ini
  Limit.perMinute(2).by(`email:${(ctx.body as any)?.email ?? ''}`), // batas per-email
])
```

Builder `Limit`: `perSecond(max, seconds?)`, `perMinute(max)`,
`perMinutes(minutes, max)`, `perHour(max, hours?)`, `perDay(max, days?)`,
`none()` (tanpa batas — melewati store sepenuhnya). Modifier chainable:
`.by(key)` (segmentasi bucket — per-user, per-email, override per-IP),
`.response(fn)` (response penolakan custom), `.after(fn)` (lihat
[di bawah](#penghitungan-tertunda-after)).

Satu limiter bisa mengembalikan **beberapa limit sekaligus** — setiap
request dicek terhadap semuanya, dan **yang pertama terlampaui yang
menang** (batas per-segmen yang lebih ketat bisa menolak lebih dulu
sebelum batas global yang lebih longgar bahkan mendekati). Setiap limit
dalam array punya bucket independen sendiri, jadi pasangan 5/menit global
+ 2/menit per-email melacak dua counter terpisah, bukan satu.

## Menerapkan sebagai middleware

```ts
route().post('/login', handler, { middleware: 'throttle:login' }) // bernama
route().get('/api/ping', handler, { middleware: 'throttle:60,1' }) // inline: max,decayMinutes
```

Bentuk inline tidak punya cara untuk mengatur response custom atau
beberapa limit — pakai limiter bernama (`RateLimiter.for`) kapan pun kamu
butuh salah satunya.

## Rate limiting programatik

Batasi logika yang tidak berada di balik route HTTP — pengiriman OTP,
retry loop — memakai facade dan store yang sama:

```ts
import { RateLimiter } from '@elyvel/core'

const key = `otp:${phone}`

const sent = await RateLimiter.attempt(key, 3, async () => {
  await sendOtp(phone)
  return true
}, 60 * 15) // 3 pengiriman per 15 menit

if (!sent) {
  // sudah mencapai batas — attempt() tidak menjalankan callback
}
```

Facade lengkap: `attempt(key, max, callback, decaySeconds?)`, `hit(key,
decaySeconds?)`, `increment(key, decaySeconds?, amount?)`,
`tooManyAttempts(key, max)`, `remaining`/`retriesLeft(key, max)`,
`attempts(key)`, `resetAttempts`/`clear(key)`, `availableIn(key)`.

## Store di baliknya

```ts
import { configureRateLimiterStore, RedisRateLimiterStore } from '@elyvel/core'

configureRateLimiterStore(new RedisRateLimiterStore(redisClient))
```

Default-nya `MemoryRateLimiterStore` in-memory — cukup untuk satu proses,
tapi deployment multi-instance di belakang load balancer secara efektif
melipatgandakan setiap batas sesuai jumlah instance, karena setiap proses
menghitung sendiri-sendiri. `RedisRateLimiterStore` membagi hitungan
antar semua instance sebagai gantinya. Keduanya mengimplementasikan
interface `RateLimiterStore` yang sama kecilnya
(`increment`/`attempts`/`reset`/`availableIn`), jadi store custom pun sama
mudahnya untuk dipasang.

## Mempercayai header proxy

Secara default, IP client yang dipakai untuk throttling per-IP berasal
dari koneksi socket sesungguhnya — mempercayai `X-Forwarded-For` secara
default akan memungkinkan attacker merotasi header itu per request dan
sepenuhnya mengalahkan throttling berbasis IP. Di belakang reverse proxy
sungguhan, opt-in secara eksplisit:

```ts
import { trustProxies } from '@elyvel/core'

trustProxies() // sekarang membaca X-Forwarded-For (fallback ke X-Real-IP)
```

## Header response & kustomisasi

Setiap request yang di-throttle mendapat `x-ratelimit-limit` dan
`x-ratelimit-remaining` (dibatasi minimal 0); yang ditolak juga mendapat
`retry-after` (detik sampai window reset) dan `429` dengan `{ message:
'Too Many Requests' }` (bisa diterjemahkan). Override response penolakan
per-limit:

```ts
RateLimiter.for('api', () =>
  Limit.perMinute(60).response((ctx, headers) => ctx.status(429, { retryAfter: headers['retry-after'] })))
```

## Penghitungan tertunda: `.after()`

Biasanya sebuah request langsung dihitung terhadap batasnya begitu tiba.
`.after(status => boolean)` menunda keputusan itu sampai status response
diketahui — hitung hanya 404, hanya 5xx, hanya login yang gagal, apa pun
yang diputuskan callback-nya:

```ts
RateLimiter.for('search', () => Limit.perMinute(10).after(status => status === 404))
```

Ini menjalankan increment sesungguhnya di hook `onAfterResponse` — benar-
benar setelah response sudah dikirim, bukan secara sinkron di dalam
handler. Artinya memeriksa state rate-limit (`RateLimiter.attempts(key)`)
tepat setelah sebuah request selesai di dalam proses mungkin belum
mencerminkan hitungan berbasis `.after()`; ini dijamin benar pada saat
request *berikutnya* tiba lewat jaringan, hanya saja tidak pada saat
persis objek response saat ini dikembalikan. Limit biasa (tanpa
`.after()`) tidak punya catatan ini — mereka dihitung secara sinkron
selama `handle()`.
