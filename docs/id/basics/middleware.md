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
