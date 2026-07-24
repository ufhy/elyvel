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
`Response.deny(message, status?)`, `Response.denyAsNotFound()` (404, bukan 403
— menyembunyikan keberadaan sebuah resource dari user yang tidak berwenang).

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

## Memeriksa ability

Gate menyediakan pengecekan langsung, atau ikat user sekali dengan `forUser`
untuk permukaan yang ergonomis per-request (inilah yang menjadi
`ctx.can`/`ctx.cannot`/`ctx.authorize` di route handler — lihat
[Autentikasi](/id/security/authentication)):

```ts
gate().allows('update', user, post) // boolean
gate().denies('update', user, post) // boolean
gate().forUser(user).authorize('update', post) // throws AuthorizationError if denied
```

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

## Pengecekan inline

Untuk kondisi sekali-pakai yang tidak layak dijadikan named ability atau method
policy, `allowIf`/`denyIf` langsung melempar:

```ts
gate().allowIf(user?.emailVerified === true, user, 'Verify your email first.')
```
