# Controllers

Alih-alih mendefinisikan setiap handler sebagai closure di dalam file route, Anda
dapat mengelompokkan logika penanganan request yang berkaitan ke dalam sebuah
class **controller**. Controller berpasangan secara alami dengan `resource()` /
`apiResource()` (lihat [Routing](/id/basics/routing)).

## Menulis controller

Sebuah controller meng-extend `Controller` dan mendefinisikan satu method per
aksi. Setiap method menerima request context dan mengembalikan sebuah response:

```ts
// app/controllers/PostController.ts
import type { MiddlewareContext } from '@elyvel/core'
import { Controller } from '@elyvel/core'
import { Post } from '../models/Post'

export class PostController extends Controller {
  /** GET /posts */
  async index() {
    return Post.query().latest().get()
  }

  /** GET /posts/:id */
  async show(ctx: MiddlewareContext) {
    return Post.find(ctx.params.id)
  }

  /** POST /posts */
  async store(ctx: MiddlewareContext) {
    return Post.create(ctx.body as Record<string, unknown>)
  }
}
```

Buat satu dengan CLI — ia men-scaffold lima aksi JSON
(`index`/`show`/`store`/`update`/`destroy`):

```bash
bunx elyvel make:controller PostController
```

Flag membentuk apa yang digenerate:

| Flag | Menggenerate |
| --- | --- |
| `--resource` | Controller form tujuh-aksi lengkap (menambah `create`/`edit`) |
| `--invokable` | Controller single-action dengan cuma `handle()` — lihat [Controller single-action](/id/basics/routing#controller-single-action) |
| `--singleton` | Cuma `show`/`edit`/`update` (tanpa `:id`) — lihat [Singleton resource](/id/basics/routing#singleton-resource) |
| `--singleton --creatable` | Bentuk singleton, plus `create`/`store`/`destroy` |
| `--model=Post` | Menambah komentar hint yang menunjukkan wiring `resource(..., { bind: Post })` |
| `--parent=Post` | Menambah komentar hint yang menunjukkan wiring `resource()` nested/shallow |
| `--requests` | Juga menggenerate FormRequest `Store<Name>Request`/`Update<Name>Request` |
| `--force` | Timpa file yang sudah ada |

## Aksi resource

`resource()` dan `apiResource()` memetakan HTTP verb ke method controller. **Hanya
method yang benar-benar Anda definisikan yang di-route**, jadi sebuah controller
read-only cukup `index` + `show`.

| Method | Verb · Path | Catatan |
| --- | --- | --- |
| `index` | GET `/` | list |
| `create` | GET `/create` | render sebuah form create (`resource` saja) |
| `store` | POST `/` | menyimpan record baru |
| `show` | GET `/:id` | menampilkan satu |
| `edit` | GET `/:id/edit` | render sebuah form edit (`resource` saja) |
| `update` | PUT/PATCH `/:id` | menyimpan perubahan |
| `destroy` | DELETE `/:id` | menghapus |

`apiResource()` menghubungkan lima aksi JSON; `resource()` menambahkan perender
form `create`/`edit`. Hubungkan sebuah controller di dalam file `routes/`:

```ts
// routes/blog.ts
import { resource } from '@elyvel/core'
import { PostController } from '../app/controllers/PostController'

export default resource('/posts', PostController, { bind: Post })
```

## Konteks request

Setiap aksi menerima `MiddlewareContext` (`ctx`):

- `ctx.params` — parameter route (`ctx.params.id`).
- `ctx.query` — query string yang sudah diparsing.
- `ctx.body` — body request yang sudah diparsing (JSON atau `multipart/form-data`,
  di mana field file berupa instance `File`).
- `ctx.user` — user yang terautentikasi, ketika route berjalan melalui layer
  auth (lihat [Autentikasi](/id/security/authentication)).
- `ctx.model` — instance model yang di-bind, ketika resource didaftarkan dengan
  `bind` (route-model binding). Ia di-resolve sebelum aksi berjalan, jadi ia
  selalu berupa record yang sudah dimuat — atau request sudah 404 sebelumnya.
  Binding juga mendukung `bindField` (bind berdasarkan kolom selain primary
  key), `withTrashed` (izinkan baris soft-deleted), `scoped` (verifikasi child
  nested milik parent-nya), dan `onMissing` (handler custom alih-alih 404
  default) — lihat [Route model binding](/id/basics/routing#route-model-binding).
- `ctx.validated` — data yang tervalidasi, ketika aksi di-decorate dengan
  `@ValidateWith` (lihat di bawah).

```ts
async show(ctx: MiddlewareContext) {
  return ctx.model // the Post resolved from /:id via `bind: Post`
}
```

## Memvalidasi input

Validasi dengan sebuah [FormRequest](/id/basics/routing) — panggil `validate(ctx)`
statisnya, yang mengembalikan data yang tervalidasi atau melempar `422`:

```ts
import { StorePostRequest } from '../requests/StorePostRequest'

async store(ctx: MiddlewareContext) {
  const data = await StorePostRequest.validate(ctx)
  return Post.create(data)
}
```

Atau lewati pemanggilan manual dengan `@ValidateWith` — ia menjalankan
FormRequest sebelum aksi dan mengekspos hasilnya sebagai `ctx.validated`:

```ts
import { ValidateWith } from '@elyvel/core'

@ValidateWith(StorePostRequest)
async store(ctx: MiddlewareContext) {
  return Post.create(ctx.validated) // sudah tervalidasi
}
```

## Otorisasi aksi

Ketika route berjalan melalui layer auth, `ctx.authorize(ability, …)` menegakkan
sebuah policy — melempar `403` jika gagal:

```ts
async store(ctx: MiddlewareContext) {
  ctx.authorize('create', Post)
  const data = await StorePostRequest.validate(ctx)
  return Post.create(data)
}
```

Atau gunakan decorator `@Authorize` — ia menjalankan pengecekan sebelum aksi,
menggunakan `ctx.model` ketika aksinya route-model-bound:

```ts
import { Authorize } from '@elyvel/core'

@Authorize('update')
async update(ctx: MiddlewareContext) { /* ctx.model sudah dicek */ }
```

Untuk seluruh controller, `authorizeResource()` menghubungkan setiap aksi
resource ke ability konvensionalnya sekaligus (`index`→`viewAny`,
`show`→`view`, `create`/`store`→`create`, `edit`/`update`→`update`,
`destroy`→`delete`) — dipanggil di tempat resource-nya didaftarkan, bukan di
dalam class:

```ts
// routes/web.ts
import { authorizeResource, resource } from '@elyvel/core'

authorizeResource(PostController)
export default resource('/posts', PostController, { bind: Post })
```

Lihat [Otorisasi](/id/security/authorization) untuk gate dan policy.

## Middleware pada controller

`@UseMiddleware`/`@WithoutMiddleware` memasang atau mengecualikan middleware
per aksi atau untuk seluruh class (digabung dengan apa pun yang ditambahkan
`resource(..., { middleware })`, bukan menggantikannya):

```ts
import { Controller, UseMiddleware, WithoutMiddleware } from '@elyvel/core'

@UseMiddleware('auth', 'subscribed')
export class PostController extends Controller {
  @WithoutMiddleware('subscribed') // cuma 'auth' yang berlaku di sini
  async index(ctx: MiddlewareContext) { /* ... */ }
}
```

Lihat [Middleware](/id/basics/middleware) dan
[Routing](/id/basics/routing#middleware-otorisasi--validasi-di-level-controller)
untuk gambaran lengkapnya, termasuk mengatur middleware sebuah resource secara
fluent setelah registrasi.

## Response

Apa pun yang dikembalikan sebuah aksi menjadi response:

- Sebuah nilai (object/array) → **JSON**.
- `Inertia.render(page, props)` (dari `@elyvel/inertia`) atau `view(name, data)`
  (dari `@elyvel/view`) → **HTML**.
- `redirect(url)` / `back()` (dari `@elyvel/core`) → sebuah redirect.
- `Resource` / `Resource.paginated(...)` (dari `@elyvel/core`) → sebuah transformasi
  JSON berbentuk untuk response API.
- `file(path)` / `download(path)` / `streamDownload(name, source)` (dari
  `@elyvel/core`) → response file/download.

```ts
import { redirect } from '@elyvel/core'

async destroy(ctx: MiddlewareContext) {
  await ctx.model.delete()
  return redirect('/posts')
}
```

### File & download

```ts
import { download, file, streamDownload } from '@elyvel/core'

async show() {
  return file('storage/app/avatars/1.png')          // dirender inline di browser
}

async export() {
  return download('storage/app/reports/q1.pdf', 'Q1 Report.pdf')
}

async csv() {
  const rows = await Order.all()
  return streamDownload('orders.csv', rows.map(o => `${o.id},${o.total}\n`).join(''))
}
```

`file()` mengirim path secara inline (`Content-Disposition: inline`)
sehingga browser me-render-nya langsung kalau bisa (gambar, PDF);
`download()` mengirim jenis path yang sama tapi memaksa dialog save-as,
dengan filename default dari basename path-nya. `streamDownload()` untuk
konten yang kamu generate di memory atau di-stream, bukan dibaca dari
disk — `ReadableStream`, bytes, atau string biasa semuanya bisa jadi
source. Ketiganya menebak `Content-Type` dari ekstensi file kecuali kamu
mengoper `contentType` secara eksplisit.
