# View

View di sini adalah fungsi TypeScript biasa, bukan file template yang
dikompilasi — `html` adalah tagged template literal yang otomatis
meng-escape value yang diinterpolasi, tanpa bahasa template terpisah atau
konvensi file `.html`/`.eta` yang perlu dipelajari.

::: tip Kapan memakai ini
`@elyvel/view` untuk body mail, halaman error custom, dan layar
server-rendered kecil milik sendiri (dashboard, halaman health/status) —
bukan layer UI utama. Contoh andalan (`fullstack-vue`, `spa-vue`) memakai
Inertia + Vue untuk frontend sesungguhnya; pakai itu kalau kamu ingin SPA
reaktif penuh, bukan HTML server-rendered biasa.
:::

## Menulis sebuah view

```ts
// app/views/dashboard.ts
import { html } from '@elyvel/view'
import type { ViewTemplate } from '@elyvel/view'

interface DashboardProps {
  pending: number
  failed: { id: string, error: string }[]
}

const dashboard: ViewTemplate<DashboardProps> = (props, shared) => html`
  <h1>Dashboard</h1>
  <p>${props.pending} jobs pending</p>
  <ul>
    ${props.failed.map(job => html`<li>${job.id}: ${job.error}</li>`)}
  </ul>
`

export default dashboard
```

```ts
// routes/web.ts
import { view } from '@elyvel/view'
import dashboard from '../app/views/dashboard'

route().get('/dashboard', () => view(dashboard, { pending: 3, failed: [] }))
```

`view(template, props)` mengembalikan object response yang sudah dikenali
framework cara me-render-nya — kembalikan langsung dari handler. Rangkai
`.status(code)` untuk mengatur status HTTP eksplisit.

## Komposisi (tanpa sintaks layout terpisah)

Tidak ada mekanisme `@extends`/`@yield`/child-template — layout cukup
sebuah fungsi yang menerima body dan membungkusnya:

```ts
import type { Html } from '@elyvel/view'

function layout(title: string, body: Html): Html {
  return html`<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`
}

const page: ViewTemplate<{ name: string }> = props =>
  layout('Welcome', html`<h1>Hi ${props.name}</h1>`)
```

Fragment `html` bersarang dan array di-render di tempat — array hasil
`html` (dari `.map()`) di-render elemen per elemen, begini cara loop
bekerja (lihat di bawah). Ini komposisi fungsi biasa, bukan fitur
templating — sertakan sebuah "partial" dengan memanggil fungsi yang
membuatnya dan menginterpolasi hasilnya.

## Alur kontrol

Tidak ada `@if`/`@foreach` — cukup TypeScript biasa:

```ts
html`
  ${shared.errors.email ? html`<p class="err">${shared.errors.email[0]}</p>` : ''}
  <ul>${items.map(item => html`<li>${item.name}</li>`)}</ul>
`
```

Value falsy yang diinterpolasi (`null`/`false`/`undefined`) di-render
sebagai kosong, jadi `condition && html\`...\`` juga aman dipakai.

## Escaping

Setiap value biasa yang diinterpolasi otomatis di-escape HTML — ini
satu-satunya jalur untuk value yang berasal dari input pengguna, jadi
tidak ada cara untuk tidak sengaja me-render teks yang belum di-escape.
Untuk menampilkan HTML terpercaya apa adanya (misalnya entitas HTML pada
label link pagination), opt-out secara eksplisit:

```ts
import { raw } from '@elyvel/view'

html`<span>${raw('&laquo; Previous')}</span>`
```

Pakai `raw()` seperlunya saja dan jangan pernah untuk input yang
dikendalikan pengguna.

## Data shared

Ada dua jenis "shared" yang berbeda, dan keduanya bukan hal yang sama:

**Disuntikkan framework, per-request** — `shared.errors`,
`shared.old(key, fallback)`, `shared.flash(key, fallback)`, `shared.csrf`
dibangun dari session saat ini secara otomatis (konvensi
`$errors`/`old()`/CSRF-field Laravel, sebagai value/fungsi biasa alih-alih
global Blade):

```ts
html`
  <input name="email" value="${shared.old('email', '')}">
  ${shared.errors.email ? html`<p>${shared.errors.email[0]}</p>` : ''}
  <input type="hidden" name="_token" value="${shared.csrf}">
`
```

**Dikonfigurasi aplikasi, untuk seluruh proses** — `View.share(key, value)`
untuk data yang sama untuk setiap request (nama aplikasi, sebuah feature
flag), tersedia di bawah `shared.globals`:

```ts
import { View } from '@elyvel/view'

View.share('appName', 'Elyvel')
View.share('year', () => new Date().getFullYear()) // di-resolve lazy setiap render
```

::: warning Bukan per-request
`View.share()` berlaku untuk seluruh proses, bukan di-isolasi per-request
— pakai hanya untuk value yang benar-benar sama untuk setiap user. Apa
pun yang spesifik per user/request seharusnya masuk ke props milik
`view(template, props)` sendiri.
:::

Dua helper kecil membangun hidden field form yang umum dari `shared`:
`csrfField(shared)` dan `methodField('DELETE')` (untuk form HTML, yang
tidak mendukung PUT/PATCH/DELETE secara native).

## Integrasi mail

`Message.html(...)` di `@elyvel/mail` menerima apa pun yang punya method
`render()`, jadi sebuah view bisa langsung di-render ke body email:

```ts
message.html(view(welcomeEmailTemplate, { name: user.name }))
```

Karena mail dikirim di luar HTTP request, `shared` di sana tidak punya
session sungguhan — `errors`/`old`/`flash`/`csrf` masuk sebagai default
kosong.

## Link pagination

Render link prev/next + nomor halaman berjendela untuk
[paginator Eloquent](/id/database/eloquent#pagination):

```ts
import { paginationLinks } from '@elyvel/view'

const page = await Post.query().orderBy('id').paginate(15, currentPage)

html`
  <ul>${page.data.map(post => html`<li>${post.title}</li>`)}</ul>
  ${paginationLinks(page, { path: '/posts', window: 2 })}
`
```

`window` mengontrol berapa banyak nomor halaman yang tampil di tiap sisi
halaman saat ini (default 2). Apa pun dengan field
`currentPage`/`lastPage` bekerja — bukan cuma tipe `Paginator` yang
persis — jadi bentuk pagination dari `simplePaginate()`/custom bisa
disesuaikan.

## Halaman error custom

Halaman error default framework (404, 500, halaman debug khusus dev)
sudah bawaan dan tidak memakai package ini. Untuk me-render milikmu
sendiri dengan `view()`, sambungkan lewat `configureErrorPage`:

```ts
import { configureErrorPage } from '@elyvel/core'
import { view } from '@elyvel/view'

configureErrorPage((status, { message }) =>
  status === 404 ? view(notFoundPage, { message }) : undefined)
```

Me-return `undefined` untuk sebuah status kembali ke halaman bawaan.

## Testing

View adalah fungsi biasa — render langsung dan assert pada string-nya:

```ts
const shared = { errors: {}, old: () => '', flash: () => '', csrf: 'x', globals: {} }

const output = view(dashboard, { pending: 3, failed: [] }).render(shared)

expect(output).toContain('3 jobs pending')
```

Panggil `View.flushShared()` sebelum/sesudah test yang memakai
`View.share(...)` — map shared-data berlaku sepanjang proses, tidak
otomatis di-reset antar test.
