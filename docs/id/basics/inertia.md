# Inertia & Vue

Bangun aplikasi klasik yang di-routing server tapi me-render halaman Vue
utuh alih-alih JSON — tanpa layer API terpisah, tanpa router sisi client,
tapi frontend yang terasa SPA sepenuhnya reaktif. Inilah yang disambungkan
starter kit `vue` secara default.

## Setup sisi server

Daftarkan plugin-nya sekali, secara global, di `config/middleware.ts`:

```ts
// config/middleware.ts
import { inertia } from '@elyvel/inertia'

export default defineMiddlewareConfig({
  global: [
    inertia({
      vite: { entry: 'frontend/app.ts' },
      ssr: { bundle: 'public/build/ssr/ssr.js' }, // hilangkan jika tidak butuh SSR
    }),
  ],
})
```

Kembalikan `Inertia.render(component, props)` dari route atau controller
action mana pun — `component` adalah path di bawah `frontend/Pages/`
(tanpa ekstensi):

```ts
route().get('/dashboard', ({ user }) =>
  Inertia.render('Dashboard', { user, stats: computeStats() }))
```

Handler yang sama secara transparan melayani baik full-page HTML load awal
maupun setiap "visit" XHR berikutnya yang dibuat client Inertia —
controller tidak pernah perlu bercabang berdasarkan mana yang terjadi.

## Data shared

Data yang harus ikut di setiap halaman, tanpa setiap handler
mengulanginya:

```ts
import { Inertia } from '@elyvel/inertia'

// Di luar request (misalnya top-level di file route) — baseline permanen
// untuk setiap request di masa depan:
Inertia.share('auth', { twoFactorEnabled: authHasPlugin('two-factor') })
```

Memanggil `Inertia.share()` **selama** request sebaliknya men-scope-nya
hanya untuk request itu saja — aman di bawah konkurensi, tidak pernah
bocor antar request. Data per-request seperti user yang sedang login
biasanya cukup dilewatkan sebagai prop eksplisit di setiap pemanggilan
`render()` alih-alih di-share, karena sudah tersedia di request context.

## Redirect & error validasi

Validasi [FormRequest](/id/basics/controllers#memvalidasi-input) yang gagal
pada request Inertia tidak mengembalikan `422` JSON — Inertia selalu
diperlakukan sebagai lane "web" (tidak pernah lane JSON-API), jadi ia
mendapat redirect `303` kembali dengan error yang di-flash ke session
sebagai gantinya. Pada page load berikutnya, `page.props.errors` selalu
mencerminkan error yang di-flash itu — bahkan saat partial reload dengan
daftar `only` yang membatasi — jadi `form.errors.title` di halaman Vue
langsung bekerja tanpa perlu percabangan di sisi controller. Lihat
[Session](/id/digging-deeper/session#flash-data) untuk mekanisme flash
di baliknya.

## Partial reload & lazy prop

Partial reload (Inertia meminta hanya sebagian prop saat revisit)
ditangani otomatis lewat header `only`/`except` yang dikirim client
Inertia. Kontrol apa yang benar-benar dievaluasi dengan wrapper prop:

```ts
Inertia.render('Users/Index', {
  users: await User.all(),
  stats: Inertia.defer(() => computeStats()),      // dimuat setelah first paint, tidak di payload awal
  feed: Inertia.merge(() => nextPage()),           // ditambahkan (bukan diganti) di client
  flags: Inertia.always(() => featureFlags()),     // selalu dikirim, meski `only` mengecualikannya
  region: Inertia.optional(() => detectRegion()),  // hanya dievaluasi saat partial reload eksplisit memintanya
})
```

`Inertia.defer`/`.merge`/`.deepMerge`/`.always`/`.optional`/`.once`
masing-masing menyelesaikan masalah "jangan hitung atau kirim ini sampai
benar-benar dibutuhkan" yang berbeda — pakai yang sesuai. Setiap factory
membungkus callback-nya dalam class di baliknya
(`DeferProp`/`MergeProp`/`AlwaysProp`/`OptionalProp`/`OnceProp`) jika
kamu pernah perlu memeriksa atau `instanceof`-check sebuah nilai prop,
bukan cuma menghasilkannya.

## Enkripsi history & redirect ke origin lain

`Inertia.render()` mengembalikan `InertiaResponse` yang chainable dengan
beberapa kontrol per-halaman tambahan:

```ts
Inertia.render('Settings/Billing', props)
  .encryptHistory()   // enkripsi state halaman ini di history browser (misal halaman yang menampilkan data sensitif)
  .clearHistory()      // hapus semua entri history sebelumnya (misal setelah logout)
  .preserveFragment()  // pertahankan #fragment URL sepanjang visit ini
```

Untuk redirect yang harus benar-benar keluar dari siklus request/response
milik elyvel sendiri (URL eksternal, atau lokasi yang tidak bisa
digabungkan client Inertia ke state halamannya saat ini), pakai
`Inertia.location(url)` alih-alih `Inertia.render(...)` — ini memaksa
navigasi browser penuh.

## Asset versioning

```ts
inertia({ version: () => buildManifestHash })
```

Saat header `X-Inertia-Version` client tidak cocok, plugin merespons
`409` alih-alih payload halaman biasa — client Inertia mendeteksi ini dan
melakukan navigasi browser penuh alih-alih menggabungkan state, jadi
asset dari deploy baru selalu termuat bersih alih-alih SPA basi yang
diam-diam menjalankan JS lama.

## Sisi frontend

```ts
// frontend/app.ts
import { createInertiaApp } from '@inertiajs/vue3'
import { createApp, h } from 'vue'

createInertiaApp({
  pages: './Pages',
  setup({ el, App, props, plugin }) {
    createApp({ render: () => h(App, props) }).use(plugin).mount(el!)
  },
})
```

Halaman berada di `frontend/Pages/**/*.vue`, cocok dengan string component
yang dilewatkan ke `Inertia.render()` (`Blog/Create` →
`frontend/Pages/Blog/Create.vue`). Layout berada di `frontend/Layouts/`.
Shorthand `pages: './Pages'` di-resolve saat build time oleh plugin
resmi `@inertiajs/vite`, bukan oleh `@elyvel/inertia` itu sendiri — package
itu hanya menyuntikkan tag `<script>`/`<link>` yang tepat ke dalam shell
HTML server-rendered.

## Server-side rendering (SSR)

Didukung, dan disambungkan di starter kit `vue` — bukan client-only.
`inertia({ ssr: { bundle: '...' } })` menunjuk ke SSR bundle yang sudah
dibuild (`vite build --ssr`); saat page load pertama plugin secara dinamis
mengimpornya, me-render `{ head, body }`, dan menyisipkannya ke dokumen
HTML alih-alih div mount kosong. Error render SSR apa pun ditelan dan
diam-diam jatuh kembali ke rendering client-only, jadi SSR bundle yang
rusak tidak pernah menjatuhkan seluruh aplikasi.

## Upload file

Tidak butuh konfigurasi khusus. Client Inertia otomatis mengganti
submission form ke `multipart/form-data` saat mengandung `File`, dan
Elysia mem-parsing field multipart menjadi instance `File` di `ctx.body`
secara native — controller cukup membaca `ctx.body.cover_image instanceof
File` langsung, tanpa penyambungan ekstra di sisi mana pun.
