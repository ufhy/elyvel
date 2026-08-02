# Routing

Route berada di direktori `routes/`. Setiap file di sana **otomatis di-mount saat
boot** — Anda melakukan default-export sebuah router dan framework akan
menghubungkannya; tidak ada file registrasi route terpusat yang harus dikelola.

## Routing dasar

Buat sebuah router dengan `route()` dan pasang handler dengan method HTTP verb:

```ts
// routes/web.ts
import { route } from '@elyvel/core'

export default route()
  .get('/api/health', () => ({ status: 'ok' }))
  .post('/api/webhooks', ({ body }) => process(body))
```

Handler menerima request context (`request`, `params`, `query`, `body`,
`set`, `status`, dan apa pun yang diturunkan oleh middleware, seperti `user`). Apa
pun yang Anda kembalikan menjadi response:

- Kembalikan sebuah nilai (object, array, string) → di-serialisasi menjadi **JSON**.
- Kembalikan `Inertia.render(...)` atau `view(...)` → **HTML**.
- Panggil `status(code, body)` → set status secara eksplisit.

```ts
route().get('/teapot', ({ status }) => status(418, { message: "I'm a teapot" }))
```

## Parameter route

Segmen dinamis menggunakan `:name` dan tersedia di `params`:

```ts
route().get('/posts/:id', ({ params }) => Post.find(params.id))
```

## File route

Setiap file di bawah `routes/` melakukan default-export sebuah router; semuanya
di-mount saat boot. Kelompokkan route yang berkaitan ke dalam file-nya sendiri
(`routes/web.ts`, `routes/blog.ts`, `routes/api.ts`) — tanpa registrasi manual.

## Middleware

Pasang middleware per route dengan opsi `middleware` — sebuah alias tunggal atau
sebuah list. Alias diberi nama di `config/middleware.ts`, dan sebuah alias dapat
menerima argumen setelah tanda titik dua:

```ts
route()
  .get('/dashboard', handler, { middleware: 'auth' })
  .post('/comments', handler, { middleware: ['auth', 'throttle:60,1'] })
```

Lihat [Middleware](/id/basics/middleware) untuk menulis middleware, bucket config
(`global` / `aliases` / `groups`), middleware bawaan, dan decorator
`@UseMiddleware`/`@WithoutMiddleware` di controller.

## Group route

Berikan `middleware` ke `route()` untuk menerapkannya pada **setiap** route di
file tersebut (`Route::group(['middleware' => ...])` milik Laravel), dan sebuah
prefix sebagai argumen pertama:

```ts
route('/admin', { middleware: ['auth'] })
  .get('/users', listUsers) // GET /admin/users, behind `auth`
  .get('/settings', settings)
```

Bundle yang dapat digunakan ulang dideklarasikan sebagai **group** dan diterapkan
dengan `.use(group())`. Group `web` bawaan menambahkan proteksi CSRF untuk route
berbasis cookie (route API/token kebal terhadap CSRF, jadi jangan sertakan mereka
di dalamnya):

```ts
import { group, route } from '@elyvel/core'

export default route()
  .use(group('web')) // CSRF for browser/session routes
  .post('/profile', updateProfile)
```

## Controller & resource route

Untuk sebuah resource RESTful lengkap, arahkan `resource()` ke sebuah controller —
ia akan menghubungkan aksi-aksi standar ala `Route::resource` milik Laravel:

```ts
import { resource } from '@elyvel/core'
import { PostController } from '../app/controllers/PostController'

export default resource('/posts', PostController)
```

| Verb | Path | Aksi controller |
| --- | --- | --- |
| GET | `/posts` | `index` |
| GET | `/posts/create` | `create` |
| POST | `/posts` | `store` |
| GET | `/posts/:id` | `show` |
| GET | `/posts/:id/edit` | `edit` |
| PUT / PATCH | `/posts/:id` | `update` |
| DELETE | `/posts/:id` | `destroy` |

Hanya aksi yang benar-benar didefinisikan controller Anda yang akan dihubungkan.
Untuk API JSON saja gunakan `apiResource()`, yang menghilangkan route perender
form `create`/`edit`.

::: tip Form HTML dan PUT/PATCH/DELETE
Sebuah `<form>` HTML hanya bisa `GET`/`POST`, jadi route `update`/`destroy`
tidak terjangkau dari form post biasa — kecuali ia menyamar method-nya. Ini
ditangani otomatis untuk setiap request (padanan directive `@method`
Laravel): field hidden `_method`
(`<input type="hidden" name="_method" value="PUT">`), query param
`?_method=`, atau header `X-HTTP-Method-Override` semuanya bekerja pada
request yang aslinya `POST`, tanpa perlu setup apa pun.
:::

Batasi aksi dengan `only` / `except`, dan terapkan middleware per aksi:

```ts
resource('/posts', PostController, {
  only: ['index', 'show', 'store'],
  middleware: {
    store: ['auth', 'csrf'],
  },
})
```

### Mengubah middleware setelah registrasi

Object yang dikembalikan `resource()`/`apiResource()` juga punya penyesuaian
fluent ala Laravel setelah registrasi — berguna kalau Anda ingin mengatur
middleware satu resource langsung di tempat pemanggilannya, bukan lewat
`options.middleware`:

```ts
resource('/posts', PostController)
  .middleware('auth') // setiap aksi
  .middlewareFor(['store', 'update', 'destroy'], 'verified') // cuma aksi ini
  .withoutMiddlewareFor('index', 'auth') // index tetap publik
```

### Middleware, otorisasi & validasi di level controller

Selain (atau bersama) `resource(..., { middleware })`, sebuah controller bisa
mendeklarasikan middleware, pengecekan ability, dan validasinya sendiri lewat
decorator — padanan `#[Middleware]`/`#[Authorize]`/type-hinted-`FormRequest`
milik Laravel. Ini digabung dengan apa pun yang ditambahkan opsi `resource()`
sendiri, bukan menggantikannya:

```ts
import { Authorize, Controller, UseMiddleware, ValidateWith, WithoutMiddleware } from '@elyvel/core'
import { StorePostRequest } from '../requests/StorePostRequest'

@UseMiddleware('auth', 'subscribed')
export class PostController extends Controller {
  @WithoutMiddleware('subscribed') // cuma 'auth' yang berlaku di index
  async index(ctx: MiddlewareContext) { /* ... */ }

  @ValidateWith(StorePostRequest)
  async store(ctx: MiddlewareContext) {
    return Post.create(ctx.validated) // sudah tervalidasi — tanpa panggilan .validate() manual
  }

  @Authorize('update') // ctx.authorize('update', ctx.model) sebelum aksi berjalan
  async update(ctx: MiddlewareContext) { /* ... */ }
}
```

`@UseMiddleware`/`@WithoutMiddleware` bekerja di class (setiap aksi) atau satu
method. `@Authorize` berjalan *setelah* route model binding, jadi `ctx.model`
sudah ter-resolve saat pengecekan ability dilakukan.

Untuk seluruh resource, `authorizeResource()` menghubungkan setiap aksi ke
ability policy konvensionalnya sekaligus (`$this->authorizeResource()` milik
Laravel) — `index`→`viewAny`, `show`→`view`, `create`/`store`→`create`,
`edit`/`update`→`update`, `destroy`→`delete` — daripada `@Authorize` di setiap
method. `@Authorize` eksplisit di method tertentu tetap menang:

```ts
authorizeResource(PostController)
export default resource('/posts', PostController, { bind: Post })
```

### Menggabungkan beberapa resource

Sebuah file route melakukan default-export **satu** router, tetapi `resource()`
mengembalikan sebuah plugin yang dapat dikomposisi — jadi Anda tidak memerlukan
satu file per resource. Rangkai sebanyak yang Anda mau dengan `.use()` dalam satu
file:

```ts
// routes/api.ts
export default route()
  .use(resource('/posts', PostController))
  .use(resource('/users', UserController))
  .use(resource('/comments', CommentController))
```

Atau daftarkan beberapa sekaligus dengan `resources()`/`apiResources()`
(`Route::resources`/`Route::apiResources` milik Laravel) — sebuah map segmen
URL → controller, berbagi opsi yang sama:

```ts
import { resources } from '@elyvel/core'

export default resources({
  posts: PostController,
  users: UserController,
  comments: CommentController,
})
```

Bagaimana Anda memisahkannya murni bersifat organisasional: simpan mereka
bersama, atau kelompokkan berdasarkan domain di beberapa file (`routes/blog.ts`,
`routes/shop.ts`) atau bahkan subfolder (`routes/admin/*.ts`). Setiap `*.ts` di
bawah `routes/` — termasuk subfolder — otomatis di-mount.

## Route model binding

Berikan `bind` untuk me-resolve parameter URL menjadi sebuah instance model
secara otomatis (implicit binding milik Laravel). Model yang di-resolve tersedia
sebagai `ctx.model` di dalam controller:

```ts
resource('/posts', PostController, {
  bind: Post, // /posts/:id → Post.find(id), injected as ctx.model
})
```

Bind berdasarkan kolom selain primary key dengan **opsi** `bindField`
(`/posts/{post:slug}` milik Laravel) — nama segmen URL tidak berubah:

```ts
resource('/posts', PostController, { bind: Post, bindField: 'slug' })
```

Izinkan baris soft-deleted ikut ter-resolve juga (`->withTrashed()` milik
Laravel) — `true` berlaku untuk `show`/`edit`/`update` (default Laravel), atau
sebutkan sebagian aksi secara eksplisit. Model yang di-bind butuh
`findWithTrashed`/`resolveRouteBindingWithTrashed` (`Model` milik elyvel sudah
punya keduanya):

```ts
resource('/posts', PostController, { bind: Post, withTrashed: true })
```

Jalankan handler Anda sendiri alih-alih 404 default saat binding tidak
menemukan apa pun, dengan `onMissing`:

```ts
resource('/posts', PostController, {
  bind: Post,
  onMissing: ctx => ctx.status(404, { message: 'No such post.' }),
})
```

### Menyarangkan resource

Ganti nama segmen dengan `param` — diperlukan saat menyarangkan resource, sehingga
parent dan child sepakat mengenai nama parameter:

```ts
resource('/blog', PostController, { bind: Post, param: 'post' })
  .use(apiResource('/:post/comments', CommentController, { bind: Comment }))
```

Verifikasi bahwa child yang di-resolve benar-benar milik parent-nya, bukan
sekadar resolve berdasarkan id-nya sendiri, dengan `scoped` (`->scoped()` milik
Laravel) — ketidakcocokan akan 404 (atau menjalankan `onMissing`) persis seperti
baris yang tidak ditemukan:

```ts
resource('/photos/:photo/comments', CommentController, {
  bind: Comment,
  scoped: { photo: 'photo_id' },
})
// GET /photos/1/comments/5 → 404 kecuali photo_id milik Comment#5 adalah 1
```

Untuk resource yang bersarang dalam-dalam, `shallow` (`->shallow()` milik
Laravel) mempertahankan aksi koleksi (`index`/`create`/`store`) di bawah path
nested penuh, tapi memindahkan aksi member (`show`/`edit`/`update`/`destroy` —
yang sudah membawa id unik) ke path datar `/<resource>/:id` alih-alih mengulang
segmen parent:

```ts
resource('/photos/:photo/comments', CommentController, { shallow: true })
// index/create/store → /photos/:photo/comments
// show/edit/update/destroy → /comments/:id
```

## Singleton resource

Untuk resource tanpa id — satu instance per context, seperti `/profile` atau
`/settings` — gunakan `singleton()` (`Route::singleton` milik Laravel) alih-alih
`resource()`. Controller me-resolve instance tunggalnya sendiri (mis. dari
`ctx.user`):

| Verb | Path | Aksi |
| --- | --- | --- |
| GET | `/` | `show` |
| GET | `/edit` | `edit` |
| PUT / PATCH | `/` | `update` |

```ts
import { singleton } from '@elyvel/core'

export default singleton('/profile', ProfileController)
```

`{ creatable: true }` menambahkan `create`/`store`/`destroy` (`->creatable()`
milik Laravel); `{ destroyable: true }` menambahkan `destroy` saja tanpa
create/store. `apiSingleton()` adalah varian JSON-only-nya (tanpa route form
`create`/`edit`) — `show`/`update` secara default, `{ creatable: true }`
menambahkan `store`/`destroy`.

## Controller single-action

Untuk controller yang cuma melakukan satu hal, definisikan `handle()` (atau
`__invoke()`) dan hubungkan dengan `invoke()` (single-action controller milik
Laravel) alih-alih `resource()` penuh:

```ts
import { invoke, route } from '@elyvel/core'
import { ProvisionServer } from '../app/controllers/ProvisionServer'

export default route().post('/provision', invoke(ProvisionServer))
```

## Route fallback

`fallback()` (`Route::fallback` milik Laravel) berjalan saat tidak ada yang
cocok — default-export dari file `routes/` (dimuat terakhir) atau `.use()` di
root:

```ts
import { fallback } from '@elyvel/core'

export default fallback(ctx => ctx.status(404, { message: 'Not found.' }))
```

## Named route & pembuatan URL

Beri nama sebuah template route, lalu bangun URL darinya dengan `urlFor()`
(helper `route()` milik Laravel):

```ts
import { named, urlFor } from '@elyvel/core'

named('posts.show', '/posts/:id')

urlFor('posts.show', { id: 42 }) // "/posts/42"
urlFor('posts.index', { page: 2 }) // "/posts?page=2" — extras become query params
```

`resource()`/`apiResource()` bisa mendaftarkan nama untuk semua aksinya
sekaligus lewat opsi `name` — setiap aksi mendapat `<name>.<action>`
(`posts.index`, `posts.show`, ...):

```ts
resource('/posts', PostController, { name: 'posts' })
```

Timpa nama aksi tertentu dengan `names` (`->names()` milik Laravel) alih-alih
pola seragam:

```ts
resource('/photos', PhotoController, {
  name: 'photos',
  names: { create: 'photos.build' }, // create → photos.build; sisanya → photos.<action>
})
```

### URL bertanda tangan

Tautan yang membawa bukti bahwa aplikasi inilah yang menerbitkannya — padanan
`URL::signedRoute()` di Laravel. Yang diautentikasi adalah **aksinya**, bukan
orangnya: tautan unsubscribe di email, unduhan sekali pakai, undangan.

```ts
import { hasValidSignature, signedUrl } from '@elyvel/core'

signedUrl('unsubscribe', { user: 42 })
// "/unsubscribe/42?signature=9f86d081…"

signedUrl('download', { id: 7 }, { expiresInSeconds: 60 * 60 * 24 })
// "/files/7?expires=1767225600&signature=…"
```

Verifikasi di handler (atau middleware):

```ts
route().get('/unsubscribe/:user', ({ request, status }) => {
  if (!hasValidSignature(request.url))
    return status(403, { message: 'Tautan ini tidak valid atau sudah kedaluwarsa.' })
  // …
})
```

Alternatif yang biasa dipakai orang adalah token acak di sebuah tabel — yang
butuh tabelnya, lookup di tiap request, dan job untuk membersihkannya, demi hasil
yang sama.

Hal yang penting dalam praktik:

- Parameter **diurutkan sebelum ditandatangani**, jadi mail client atau proxy
  yang mengacak urutan query string tidak merusak tautannya.
- Mengubah parameter apa pun — termasuk memundurkan `expires` — membatalkan
  tanda tangannya.
- `signature` dan `expires` adalah nama parameter yang dicadangkan.
- Kunci penandatangan adalah `app.key`, secret yang sama dengan enkripsi dan
  cookie session. Tanpa kunci, penandatanganan melempar error; **verifikasi
  mengembalikan false**, bukan melempar, karena ia berjalan di endpoint publik
  dengan input yang dikendalikan penyerang — dan 500 di situ adalah
  denial-of-service yang kendalinya ada di tangan orang lain.

## Memeriksa route

Daftarkan setiap route yang terdaftar dengan CLI:

```bash
elyvel route:list
```

Untuk route yang didaftarkan lewat `resource()`/`apiResource()`, ini juga
menampilkan kolom **Middleware** dan **Authorize** (dari
`@UseMiddleware`/`resource({ middleware })` dan `@Authorize`/`authorizeResource()`).
Command ini belum menampilkan named route — itu dilacak terpisah lewat
`named()`/`urlFor()`, tidak ditampilkan command ini.
