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

Lihat [Autentikasi](/id/security/authentication) untuk gate dan policy.

## Response

Apa pun yang dikembalikan sebuah aksi menjadi response:

- Sebuah nilai (object/array) → **JSON**.
- `Inertia.render(page, props)` (dari `@elyvel/inertia`) atau `view(name, data)`
  (dari `@elyvel/view`) → **HTML**.
- `redirect(url)` / `back()` (dari `@elyvel/core`) → sebuah redirect.
- `Resource` / `Resource.paginated(...)` (dari `@elyvel/core`) → sebuah transformasi
  JSON berbentuk untuk response API.

```ts
import { redirect } from '@elyvel/core'

async destroy(ctx: MiddlewareContext) {
  await ctx.model.delete()
  return redirect('/posts')
}
```
