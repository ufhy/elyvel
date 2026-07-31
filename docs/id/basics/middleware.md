# Middleware

Middleware membungkus request — memeriksa atau menghentikannya sebelum mencapai
sebuah route, dan secara opsional melakukan pekerjaan setelah response dikirim.
Inilah cara guard auth, proteksi CSRF, rate limiting, dan normalisasi input
diterapkan.

## Menulis middleware

Sebuah middleware meng-extend `Middleware` dan mengimplementasikan `handle()`.
Kembalikan sebuah response untuk **menghentikan** request; jangan kembalikan
apa pun agar request **berlanjut**:

```ts
// app/middleware/EnsureTeamMember.ts
import type { MiddlewareContext } from '@elyvel/core'
import { Middleware } from '@elyvel/core'

export class EnsureTeamMember extends Middleware {
  handle(ctx: MiddlewareContext) {
    if (!ctx.user?.teamId)
      return ctx.status(403, { message: 'You are not on a team.' })
    // returning nothing → continue to the route
  }
}
```

Buat satu dengan `bunx elyvel make:middleware EnsureTeamMember`.

Context tersebut adalah request context — `request`, `params`, `query`, `body`,
`set`, `status()`, ditambah apa pun yang diturunkan middleware sebelumnya
(mis. `user`).

## Mendaftarkan middleware

Middleware dihubungkan di `config/middleware.ts` dengan `defineMiddlewareConfig`,
yang memiliki tiga bucket:

```ts
// config/middleware.ts
import { defineMiddlewareConfig, TrimStringsMiddleware } from '@elyvel/core'
import { AuthGuard, VerifiedGuard } from '@elyvel/auth'
import { EnsureTeamMember } from '../app/middleware/EnsureTeamMember'

export default defineMiddlewareConfig({
  // Runs on every request, in order.
  global: [TrimStringsMiddleware],

  // Named middleware, assignable per route via `{ middleware: 'name' }`.
  aliases: {
    auth: AuthGuard,
    verified: VerifiedGuard,
    team: EnsureTeamMember,
  },

  // Named bundles, applied with `.use(group('name'))`.
  groups: {
    admin: ['auth', 'team'],
  },
})
```

## Global middleware

Apa pun di dalam `global` berjalan pada setiap request, secara berurutan —
gunakan untuk urusan yang berlaku di seluruh aplikasi. Contoh `fullstack-vue`
menyertakan global `SetLocale` yang memilih bahasa request dari `?lang=` atau
header `Accept-Language`:

```ts
import { Middleware, type MiddlewareContext } from '@elyvel/core'
import { setRequestLocale } from '@elyvel/i18n'

const SUPPORTED = ['en', 'id']

export class SetLocale extends Middleware {
  handle(ctx: MiddlewareContext): void {
    const fromQuery = typeof ctx.query.lang === 'string' ? ctx.query.lang : undefined
    const fromHeader = ctx.request.headers.get('accept-language')?.split(',')[0]?.trim().slice(0, 2)
    const locale = fromQuery ?? fromHeader
    if (locale && SUPPORTED.includes(locale))
      setRequestLocale(locale)
  }
}
```

Didaftarkan di `global`, ia membuat setiap response — termasuk error validasi —
kembali dalam bahasa yang dipilih (`?lang=id` → Bahasa Indonesia).

## Menerapkan middleware ke route

Referensikan sebuah alias berdasarkan nama pada sebuah route — satu, atau sebuah
list:

```ts
route()
  .get('/dashboard', handler, { middleware: 'auth' })
  .delete('/posts/:id', handler, { middleware: ['auth', 'team'] })
```

Terapkan middleware ke **setiap** route dalam sebuah file dengan meneruskannya ke
`route()`:

```ts
route('/admin', { middleware: ['auth'] })
  .get('/users', listUsers)
  .get('/settings', settings)
```

## Memasang middleware pada controller

Selain `{ middleware }` di `route()`/`resource()`, sebuah controller bisa
mendeklarasikan middleware-nya sendiri dengan decorator
`@UseMiddleware`/`@WithoutMiddleware` — di sebuah method (cuma aksi itu) atau
class (setiap aksi). Ini digabung dengan apa pun yang ditambahkan registrasi
route-nya, bukan menggantikannya:

```ts
import { Controller, UseMiddleware, WithoutMiddleware } from '@elyvel/core'

@UseMiddleware('auth', 'subscribed')
export class PostController extends Controller {
  @WithoutMiddleware('subscribed') // cuma 'auth' yang berlaku di sini
  async index(ctx: MiddlewareContext) { /* ... */ }
}
```

Lihat [Routing](/id/basics/routing#middleware-otorisasi--validasi-di-level-controller)
untuk gambaran lengkapnya bersama `@Authorize`/`@ValidateWith`, dan untuk
mengatur middleware sebuah `resource()` secara fluent setelah registrasi
(`.middleware()`/`.middlewareFor()`/`.withoutMiddlewareFor()`).

### Mengecualikan route dari middleware global atau group

`@WithoutMiddleware` juga menghapus middleware yang tidak pernah didaftarkan
route itu sendiri — stack `global` dan `group()` mana pun yang diterapkan padanya.
Itu disengaja, dan sesuai `->withoutMiddleware()` milik Laravel: satu anotasi
berarti satu hal, dari mana pun middleware-nya diterapkan. Pakai dengan sadar bahwa
ia juga mencabut proteksi global, bukan hanya yang dideklarasikan controller.
Keduanya berjalan dari hook-nya sendiri, jadi pengecualiannya dicatat terhadap
route yang cocok dan dihormati oleh guard runner bersama. Untuk route biasa (tanpa
controller), daftarkan langsung:

```ts
import { excludeMiddleware } from '@elyvel/core'

// Webhook tidak bisa membawa token CSRF — kecualikan route itu saja.
excludeMiddleware('POST', '/webhooks/stripe', ['csrf'])

// Health check yang harus tetap menjawab meski yang lain terjaga semua.
excludeMiddleware('GET', '/health', '*')
```

Namanya dicocokkan ke **alias**-nya, jadi `'throttle'` juga menggugurkan
`throttle:60,1` — pencocokan seluruh string membuat sebuah route meminta
dikecualikan lalu diam-diam tidak. `terminate` juga dilewati: middleware yang
tidak pernah jalan tidak boleh mendapat hook terminasi.

`'*'` menggugurkan setiap **guard** di route itu — class middleware dan string
alias. Ia **tidak** menghapus plugin Elysia mentah yang dipasang di sebuah group:
plugin itu dipasang lewat `.use()` dan berjalan di luar guard runner, jadi tidak
ada cara mengecualikan sebuah route darinya. Periksa dulu isi group-nya sebelum
mengandalkan `'*'`.

::: warning Pengecualian adalah lubang yang kamu buka dengan sengaja
`excludeMiddleware` melewati kontrol yang diandalkan bagian lain aplikasi.
Batasi ke method dan path yang persis, dan lebih baik sebutkan satu middleware
daripada `'*'`.
:::

## Parameter middleware

Sebuah alias dapat menerima argumen setelah tanda titik dua; argumen tersebut tiba
sebagai parameter string tambahan pada `handle()`:

```ts
route().post('/otp', handler, { middleware: 'throttle:5,1' })
```

```ts
export class ThrottleMiddleware extends Middleware {
  handle(ctx: MiddlewareContext, max: string, minutes: string) {
    // max === '5', minutes === '1'
  }
}
```

## Group

Kelompokkan beberapa middleware di bawah sebuah nama di `groups`, lalu terapkan
bundle tersebut dengan `.use(group('name'))`. Entri group dapat berupa class
middleware, nama alias, atau plugin Elysia mentah:

```ts
import { group, route } from '@elyvel/core'

export default route()
  .use(group('admin')) // ['auth', 'team']
  .get('/reports', reports)
```

## Middleware bawaan

Framework menyediakan beberapa secara out of the box (`config/middleware.ts`
Anda dapat menimpanya):

| Nama | Jenis | Apa yang dilakukan |
| --- | --- | --- |
| `csrf` (`CsrfMiddleware`) | alias | Memverifikasi CSRF token pada request yang mengubah state. |
| `throttle` (`ThrottleMiddleware`) | alias | Membatasi rate berdasarkan IP: `throttle:max,minutes`. |
| `web` | group | Menggabungkan `csrf` — terapkan pada route browser/session. |

Dua penormalisasi input (`TrimStrings` / `ConvertEmptyStringsToNull` milik
Laravel) diekspor untuk Anda tambahkan ke `global`:

```ts
import { ConvertEmptyStringsToNullMiddleware, TrimStringsMiddleware } from '@elyvel/core'

global: [TrimStringsMiddleware, ConvertEmptyStringsToNullMiddleware]
```

Group `web` adalah sebuah group, bukan global, sehingga CSRF hanya berlaku di
tempat yang Anda pilih — route API/token tetap kebal terhadap CSRF. Definisikan
ulang `web` di config Anda untuk mengubahnya.

## Rate limiting

`throttle:max,minutes` (ditunjukkan di atas) adalah bentuk sederhana per-IP
client. Untuk limiter bernama yang dapat dipakai ulang — limit berbeda per
user vs per IP, response custom, cuma menghitung percobaan yang gagal —
daftarkan satu dengan `RateLimiter.for` (`RateLimiter::for` milik Laravel),
biasanya di `boot()` sebuah service provider:

```ts
import { Limit, RateLimiter } from '@elyvel/core'

RateLimiter.for('otp', ctx =>
  Limit.perMinute(5)
    .by(ctx.user?.email ?? ctx.request.headers.get('x-forwarded-for') ?? 'guest')
    .response(ctx => ctx.status(429, { message: 'Too many OTP requests.' })),
)
```

Lalu referensikan berdasarkan nama alih-alih `max,minutes`:

```ts
route().post('/otp', handler, { middleware: 'throttle:otp' })
```

Builder `Limit`: `perSecond`/`perMinute`/`perMinutes`/`perHour`/`perDay`/`none`
(tak terbatas), `.by(key)` (segmentasi berdasarkan user id, email, apa pun),
`.response(cb)` (response custom saat terlampaui), `.after(cb)` (cuma hitung
percobaan ketika status response cocok — mis. cuma hitung percobaan login yang
gagal).

Facade `RateLimiter` juga punya method langsung dan programatik untuk
menjalankan logika Anda sendiri — `attempt`, `hit`, `increment`,
`tooManyAttempts`, `remaining`, `retriesLeft`, `resetAttempts`/`clear`,
`availableIn` — primitive yang sama yang dipakai middleware-nya sendiri.

Secara default, key client adalah alamat socket peer yang sebenarnya, bukan
`X-Forwarded-For`/`X-Real-IP` (bisa dipalsukan client kalau tidak). Di belakang
proxy/load balancer yang men-set header tersebut, opt-in dengan
`trustProxies()`:

```ts
import { trustProxies } from '@elyvel/core'

trustProxies() // sekarang X-Forwarded-For / X-Real-IP dipercaya
```

## Pekerjaan setelah response

Implementasikan `terminate()` untuk menjalankan pekerjaan *setelah* response
dikirim — logging, metrik, cleanup. Nilai kembaliannya diabaikan, dan ia tidak
dapat mengubah response:

```ts
export class RequestLogger extends Middleware {
  handle() {}
  terminate(ctx: MiddlewareContext) {
    logger.info('request', { path: new URL(ctx.request.url).pathname })
  }
}
```
