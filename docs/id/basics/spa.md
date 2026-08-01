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

## Dev server vs aset hasil build

Mana yang dipakai ditentukan satu hal: apakah dev server Vite sedang jalan
*saat itu juga*. Dev server-nya sendiri yang memberi tahu, dengan menulis
`public/hot` selama ia hidup — tambahkan plugin ke `vite.config.ts`, itu saja
setup-nya:

```ts
// vite.config.ts
import { elyvel } from '@elyvel/vite/plugin'

export default defineConfig({
  plugins: [elyvel(), /* ... */],
})
```

File itu berisi URL dev server lengkap dengan `base` Vite; backend hanya
menambahkan path aset. File-nya dihapus saat proses keluar atau menerima
sinyal, jadi begitu `vite` dihentikan, aset hasil build kembali dipakai. File
dan lokasinya sama persis dengan integrasi Vite milik Laravel.

::: warning Dulu memakai APP_ENV — dan itu bug
Keputusan ini dulu diambil dari `APP_ENV`/`NODE_ENV`, yang menjawab
pertanyaan berbeda. Deploy produksi dengan `APP_ENV` tidak di-set mengirim
URL aset `http://localhost:5173/...` ke pengunjung sungguhan: halaman
ter-render, semua aset 404 di browser, dan server tidak mencatat apa pun.
Sekarang, tanpa hot file dan tanpa manifest, kamu mendapat error yang keras.
:::

Di test yang me-render halaman tanpa build, panggil `withoutVite()` — helper
dengan nama sama seperti di Laravel — dan tag-nya kembali kosong alih-alih
melempar error:

```ts
import { withoutVite } from '@elyvel/vite'

withoutVite()
```

`devUrl` tetap ada untuk memaksa tag dev pada setup yang tidak bisa
mendeskripsikan dirinya — container dengan host berbeda, atau tunnel.

## Hubungan dengan Inertia

`spa()` dan [`inertia()`](/id/basics/inertia) menyelesaikan masalah "layani
frontend Vite" yang sama dengan dua cara berbeda: `inertia()` me-render
halaman server-driven dengan props (tanpa API JSON terpisah, tanpa router
client-side yang dibutuhkan untuk data), sementara `spa()` melayani shell
statis dan menyerahkan routing/pengambilan data sepenuhnya ke client.
Keduanya berbagi primitif `viteTags()`/`ViteOptions` yang sama di
baliknya untuk memancarkan tag asset dev-server vs. manifest-production —
pilih satu pendekatan per aplikasi, bukan keduanya.
