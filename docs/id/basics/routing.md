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
(`global` / `aliases` / `groups`), dan middleware bawaan.

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

Batasi aksi dengan `only` / `except`, dan terapkan middleware per aksi:

```ts
resource('/posts', PostController, {
  only: ['index', 'show', 'store'],
  middleware: {
    store: ['auth', 'csrf'],
  },
})
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

Ganti nama segmen dengan `param` — diperlukan saat menyarangkan resource, sehingga
parent dan child sepakat mengenai nama parameter:

```ts
resource('/blog', PostController, { bind: Post, param: 'post' })
  .use(apiResource('/:post/comments', CommentController, { bind: Comment }))
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

## Memeriksa route

Daftarkan setiap route yang terdaftar (dan named route) dengan CLI:

```bash
elyvel route:list
```
