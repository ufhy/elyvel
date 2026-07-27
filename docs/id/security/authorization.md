# Otorisasi

Otorisasi menjawab "apakah user ini boleh melakukan ini?" — berbeda dari
autentikasi ("siapa user ini?"). **Gate** elyvel menyediakan named ability
maupun **policy** per-model (Laravel's `Gate`/`Policy`).

## Gate

`gate()` adalah gate default yang berlaku satu app, dikonfigurasi sekali
(biasanya di `boot()` sebuah service provider):

```ts
import { gate } from '@elyvel/auth'

export class AppServiceProvider extends ServiceProvider {
  override boot(): void {
    gate().policy(Post, new PostPolicy())
  }
}
```

### Named ability

Definisikan ability mandiri dengan closure — berguna untuk pengecekan yang
tidak terkait model tertentu:

```ts
gate().define('viewAdminPanel', user => user?.role === 'admin')
```

```ts
gate().allows('viewAdminPanel', user) // boolean
```

Secara default sebuah ability tidak berjalan sama sekali untuk guest (`user`
adalah `null`) — kirim `{ allowGuest: true }` sebagai argumen ketiga saat
ability-nya sendiri perlu menangani kasus belum-terautentikasi:

```ts
gate().define('viewPublicStats', user => user === null || user.role !== 'banned', {
  allowGuest: true,
})
```

## Policy

Policy mengelompokkan ability untuk satu model ke dalam sebuah class — satu
method per ability, dinamai sesuai aksinya:

```ts
// app/policies/PostPolicy.ts
import type { User } from '@elyvel/auth'
import type { Post } from '../models/Post'
import { Response } from '@elyvel/auth'

export class PostPolicy {
  /** Any signed-in user may create a post. */
  create(_user: User | null): boolean {
    return true
  }

  /** Only the author may update their post. */
  update(user: User | null, model: Post): boolean | Response {
    return user?.id === model.user_id
      ? Response.allow()
      : Response.deny('You can only edit your own posts.')
  }
}

export default PostPolicy
```

Generate dengan `bunx elyvel make:policy PostPolicy --model=Post`. Daftarkan ke
model-nya — gate kemudian merutekan pengecekan mana pun yang argumen
pertamanya sebuah instance `Post` (atau class `Post` itu sendiri, untuk
pengecekan gaya `create`) ke policy ini:

```ts
gate().policy(Post, new PostPolicy())
```

Sebuah method bisa mengembalikan `boolean` biasa, atau `Response` saat kamu
ingin pesan/status penolakan spesifik: `Response.allow()`,
`Response.deny(message, status?)`, `Response.denyWithStatus(status, message?)`
(set status tanpa pesan "unauthorized" default), `Response.denyAsNotFound()`
(404, bukan 403 — menyembunyikan keberadaan sebuah resource dari user yang
tidak berwenang).

### `before` — filter untuk seluruh policy

Berjalan sebelum method policy mana pun; hasil yang bukan `null`/`undefined`
langsung memutus (mis. bypass untuk super-admin):

```ts
class PostPolicy {
  before(user: User | null): boolean | undefined {
    if (user?.role === 'admin')
      return true // skip the rest of the checks
    return undefined // fall through to the specific method
  }
}
```

Gate itu sendiri juga punya hook `before`/`after` yang berlaku satu app — untuk
logika yang harus berlaku di *setiap* ability/policy, bukan cuma method satu
policy (`Gate::before`/`Gate::after` milik Laravel):

```ts
gate().before((user, ability, args) => {
  if (user?.role === 'super-admin')
    return true // memutus setiap pengecekan, ability apa pun
  return undefined // lanjut seperti biasa
})

gate().after((user, ability, result, args) => {
  // hanya dikonsultasikan ketika ability/policy-nya sendiri mengembalikan null/undefined
})
```

## Memeriksa ability

Gate menyediakan pengecekan langsung, atau ikat user sekali dengan `forUser`
untuk permukaan yang ergonomis per-request (inilah yang menjadi
`ctx.can`/`ctx.cannot`/`ctx.authorize` di route handler — lihat
[Autentikasi](/id/security/authentication)):

```ts
gate().allows('update', user, post) // boolean
gate().denies('update', user, post) // boolean
gate().check('update', user, post) // alias dari allows
gate().any(['update', 'delete'], user, post) // true kalau SALAH SATU ability lolos
gate().none(['update', 'delete'], user, post) // true kalau TIDAK ADA yang lolos
gate().inspect('update', user, post) // Response lengkap — allowed()/message()/status()
gate().forUser(user).authorize('update', post) // throws AuthorizationError if denied
```

`forUser(user)` mengembalikan permukaan `check`/`any`/`none`/`inspect` yang
sama dengan `user` sudah terikat (`gate().forUser(user).any([...], post)`, dst).

Di controller:

```ts
async update(ctx: MiddlewareContext) {
  ctx.authorize('update', ctx.model) // throws 403 (or the policy's Response) if denied
  const data = await UpdatePostRequest.validate(ctx)
  return ctx.model.update(data)
}
```

## Menggerbang route berdasarkan ability

Pada router `webRoute()` (yang sudah menghubungkan lapisan auth — lihat
[Autentikasi](/id/security/authentication)), kirim `can` sebagai opsi route
untuk menolak sebelum handler-nya berjalan sama sekali. Fungsi resolver
menerima konteks request; nilai lain diteruskan sebagai argumen tambahan ke
ability:

```ts
webRoute().delete('/posts/:id', destroy, {
  can: ['update', ctx => ctx.model],
})
```

### Mengotorisasi seluruh controller resource

Alih-alih pengecekan ability di dalam setiap aksi, `@Authorize` pada method
controller menjalankan pengecekan sebelum aksi (menggunakan `ctx.model` ketika
route-nya model-bound):

```ts
import { Authorize, Controller } from '@elyvel/core'

export class PostController extends Controller {
  @Authorize('update')
  async update(ctx: MiddlewareContext) { /* ctx.model sudah dicek */ }
}
```

`authorizeResource()` menghubungkan setiap aksi resource ke ability
konvensionalnya sekaligus (`$this->authorizeResource()` milik Laravel) —
`index`→`viewAny`, `show`→`view`, `create`/`store`→`create`,
`edit`/`update`→`update`, `destroy`→`delete` — dipanggil di tempat resource-nya
didaftarkan, bukan di dalam class. `@Authorize` eksplisit di method tertentu
tetap menang atas default ini:

```ts
// routes/web.ts
import { authorizeResource, resource } from '@elyvel/core'

authorizeResource(PostController)
export default resource('/posts', PostController, { bind: Post })
```

Lihat [Controllers](/id/basics/controllers#otorisasi-aksi) untuk lebih lanjut.

## Pengecekan inline

Untuk kondisi sekali-pakai yang tidak layak dijadikan named ability atau method
policy, `allowIf`/`denyIf` langsung melempar:

```ts
gate().allowIf(user?.emailVerified === true, user, 'Verify your email first.')
```
