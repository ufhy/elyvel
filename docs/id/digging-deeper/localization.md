# Localization

Terjemahkan string, lengkap dengan pluralization dan substitusi placeholder,
dari file per-locale — plus konvensi namespace yang memungkinkan package
`@elyvel/*` mana pun mengirimkan pesan yang bisa diterjemahkan sendiri.

## Konfigurasi

```ts
// config/i18n.ts
import { defineI18nConfig } from '@elyvel/i18n'

export default defineI18nConfig({
  locale: process.env.APP_LOCALE ?? 'en',
  fallback: 'en',
  path: 'lang', // default
})
```

Tidak ada daftar "locale yang didukung" terpisah di config — jika kamu
membatasi locale mana yang bisa dipilih (misalnya dari query param atau
header), terapkan itu sendiri di tempat kamu mengatur locale-nya (lihat
[Mengatur locale](#mengatur-locale) di bawah).

## File terjemahan

```ts
// lang/en/messages.ts
export default {
  greeting: 'Hello :Name',
  apples: '{0} No apples|[1,19] :count apple(s)|[20,*] Many apples',
}
```

```ts
// lang/id/messages.ts
export default {
  greeting: 'Halo :Name',
}
```

- `lang/<locale>/<group>.ts` → key di-resolve sebagai `<group>.<key>`
  (misal `messages.greeting`).
- `lang/<locale>.ts` (tanpa subfolder) → key kalimat utuh tanpa prefix
  group, untuk pemakaian gaya `__('I love programming.')`.
- `lang/vendor/<namespace>/<locale>/<file>.ts` → meng-override terjemahan
  milik sebuah **package** dari aplikasimu sendiri (lihat di bawah).

Setiap file adalah modul TypeScript/JavaScript biasa dengan default-export
sebuah object — bukan file JSON.

## Terjemahan yang dikirim package

Package `@elyvel/*` mana pun bisa mengirim direktori `lang/`-nya sendiri;
baris-barisnya dimuat ke namespace terpisah dan direferensikan sebagai
`<package>::<key>`:

```ts
trans('broadcasting::errors.unauthorized', {}, 'Unauthorized')
```

Argumen ketiga adalah fallback bahasa Inggris yang dipakai jika tidak ada
translator terpasang sama sekali, atau key-nya tidak ditemukan di mana
pun — begini cara package framework (validation, auth, broadcasting)
menghasilkan pesan terjemahan tanpa bergantung pada `@elyvel/i18n`
terpasang. Override baris milik sebuah package dari aplikasimu sendiri
dengan `lang/vendor/<package>/<locale>/<file>.ts` — versimu yang menang,
dan apa pun yang tidak kamu override tetap jatuh ke default package-nya.

## Memakai terjemahan

```ts
import { __, transChoice } from '@elyvel/i18n'

__('messages.greeting', { name: 'ada' })           // 'Hello Ada' — :Name mengkapitalkan value
transChoice('messages.apples', 0)                  // 'No apples'
transChoice('messages.apples', 5)                  // '5 apple(s)'
```

`trans` adalah alias dari `__`. Placeholder: `:name` disubstitusi apa
adanya, `:Name` mengkapitalkan, `:NAME` menjadikan huruf besar semua.
Pluralization (`transChoice`) memilih segmen yang tepat untuk jumlahnya
memakai aturan plural asli setiap locale (lewat `Intl.PluralRules`) — dua
bentuk bahasa Inggris, `one`/`few`/`many`/`other` bahasa Rusia, atau bentuk
tunggal bahasa Indonesia berapa pun jumlahnya — plus segmen rentang
eksplisit `{0}`/`[1,19]`/`[20,*]` yang lebih diprioritaskan daripada aturan
turunan CLDR.

Di dalam handler request, helper yang sama sudah tersedia di context:
`ctx.locale`, `ctx.__`, `ctx.trans`, `ctx.transChoice`.

## Mengatur locale

**Tidak ada deteksi locale otomatis** — framework sengaja tidak
menyimpulkan locale dari `Accept-Language` atau query param dengan
sendirinya. Atur secara eksplisit, biasanya dari middleware kecil di level
aplikasi:

```ts
// app/middleware/SetLocale.ts
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

Daftarkan secara global supaya error validasi dan hal lain di baliknya
juga ikut diterjemahkan. `setRequestLocale()` aman dipanggil setelah
`await` (misalnya setelah pencarian session) — ia di-scope per-request,
tidak terikat pada pemanggilan sinkron di `onRequest`.

Untuk scoping sekali pakai di luar request (script, job), pakai
`runWithLocale(locale, fn)` sebagai gantinya. `currentLocale()`/`getLocale()`
membaca locale mana pun yang sedang aktif; `setLocale(locale)` mengubah
default untuk seluruh proses, bukan override per-request.

## Integrasi frontend

Belum ada jembatan bawaan ke Vue/Inertia — terjemahan hanya urusan sisi
server saat ini. Jika frontend-mu butuh string terjemahan atau locale
aktif, bagikan sendiri sebagai prop Inertia (misalnya
`Inertia.share('locale', ctx => ctx.locale)`) alih-alih mengharapkan
mekanisme bawaan.

## Perilaku fallback

Key yang hilang di locale aktif jatuh ke locale `fallback`; key yang
hilang di keduanya dikembalikan apa adanya (string key itu sendiri),
mengikuti perilaku Laravel — tidak pernah melempar error. Opt-in untuk
mencatat setiap key yang hilang dengan `logMissing: true` di
`config/i18n.ts`.

## Testing

```ts
import { runWithLocale } from '@elyvel/i18n'

const greeting = runWithLocale('id', () => __('messages.greeting', { name: 'Ada' }))
```

`runWithLocale` di-scope dengan bersih di sekitar pekerjaan konkuren —
pemanggilan paralel (atau request paralel yang masing-masing memanggil
`setRequestLocale` di `beforeHandle`-nya sendiri) tidak saling bocor.
