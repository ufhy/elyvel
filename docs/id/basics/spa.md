# SPA Standalone (tanpa Inertia)

Untuk frontend yang sepenuhnya di-routing client-side (Vue/React/Svelte +
router milikmu sendiri) didukung API JSON polos alih-alih Inertia — pola
yang dipakai starter kit `spa`.

## Pemakaian

```ts
// routes/web.ts
import { route } from '@elyvel/core'
import { spa } from '@elyvel/vite'

export default route().use(
  spa({ entry: 'frontend/app.ts', title: 'My App', prefix: '/' }),
)
```

Ini mount asset Vite yang sudah dibuild (atau dev-server) dan
mengembalikan shell SPA — dokumen HTML polos dengan tag
`<script>`/`<link>` yang tepat — untuk setiap route di bawah `prefix`,
jadi navigasi client-side dan deep link (`/dashboard/settings` dimuat
langsung) keduanya bekerja. Pasangkan dengan API JSON milikmu sendiri di
prefix terpisah (biasanya `/api`, memakai transform
[Resource](/id/basics/controllers) + auth Bearer-token) — `spa()` hanya
menangani shell frontend, bukan endpoint data-mu.

## Opsi

```ts
spa({
  entry: 'frontend/app.ts',     // entry point client
  prefix: '/',                  // di mana SPA di-mount; default root
  rootId: 'app',                // id elemen yang di-mount client
  buildDir: 'public/build',     // direktori asset yang sudah dibuild
  title: 'My App',              // <title> untuk shell
  head: faviconHtml + themeScript, // HTML <head> tambahan sebelum tag Vite
  assets: true,                 // layani buildDir di `base` — false jika route lain sudah melakukannya
})
```

`html(opts)` meng-override seluruh dokumen shell jika default tidak
cukup:

```ts
spa({
  entry: 'frontend/app.ts',
  html: ({ head, rootId, title }) => `<!doctype html><html>...</html>`,
})
```

## Bagaimana deep link bekerja

Route client-side seperti `/dashboard/settings` tidak punya route server
yang cocok, jadi normalnya akan 404. `spa()` menyambung ke
[`configureErrorPage`](/id/digging-deeper/views#halaman-error-custom): 404
apa pun yang bukan di bawah `/api` atau `base` asset mendapat shell SPA
alih-alih halaman 404 sungguhan, membiarkan router client-side mengambil
alih dan me-render view yang benar. 404 API dan 404 asset tidak
terpengaruh — fallback ini hanya menangkap navigasi HTML.

## Hubungan dengan Inertia

`spa()` dan [`inertia()`](/id/basics/inertia) menyelesaikan masalah "layani
frontend Vite" yang sama dengan dua cara berbeda: `inertia()` me-render
halaman server-driven dengan props (tanpa API JSON terpisah, tanpa router
client-side yang dibutuhkan untuk data), sementara `spa()` melayani shell
statis dan menyerahkan routing/pengambilan data sepenuhnya ke client.
Keduanya berbagi primitif `viteTags()`/`ViteOptions` yang sama di
baliknya untuk memancarkan tag asset dev-server vs. manifest-production —
pilih satu pendekatan per aplikasi, bukan keduanya.
