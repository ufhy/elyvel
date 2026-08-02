# API Resource

Lapisan antara model dan JSON yang dikembalikan API-mu — `JsonResource` milik
Laravel. Tanpa itu, controller entah mengembalikan model apa adanya, yang
membocorkan setiap kolom begitu ada yang menambahnya, atau menulis object literal
per endpoint, yang lama-lama berbeda antara tampilan list dan detail untuk hal
yang sama.

## Menulisnya

```ts
// app/resources/UserResource.ts
import type { User } from '../models/User'
import { JsonResource } from '@elyvel/core'

export class UserResource extends JsonResource<User> {
  toArray() {
    return {
      id: this.resource.id,
      name: this.resource.name,
      created_at: this.resource.created_at,
    }
  }
}
```

Kembalikan dari route atau controller — tanpa `.toJSON()` di tempat pemanggilan:

```ts
route().get('/users/:id', async ({ params }) => UserResource.make(await User.findOrFail(params.id)))
```

```json
{ "data": { "id": 1, "name": "Ada", "created_at": "2026-01-01T00:00:00Z" } }
```

## Collection

```ts
UserResource.collection(await User.query().get())
```

```json
{ "data": [{ "id": 1, "name": "Ada" }, { "id": 2, "name": "Grace" }] }
```

## Field kondisional

`when()` **menghilangkan key-nya sama sekali**, bukan mengirim `null`. Perbedaan
itu membawa informasi: client yang memeriksa `'email' in payload` untuk menentukan
boleh-tidaknya mengubah field akan dijawab "boleh" oleh null.

```ts
toArray() {
  return {
    id: this.resource.id,
    email: this.when(this.isOwner, this.resource.email),
    deleted_at: this.whenNotNull(this.resource.deleted_at),
    admin_notes: this.mergeWhen(this.isAdmin, { internal_id: this.resource.internal_id }),
  }
}
```

- `when(condition, value, fallback?)` — nilai atau tidak sama sekali. Berikan
  fungsi untuk menunda pekerjaan yang tidak perlu jalan saat kondisinya false.
- `whenNotNull(value, fallback?)` — hanya membuang `null`/`undefined`. `0`, `''`,
  dan `false` adalah nilai, jadi tetap dikirim.
- `mergeWhen(condition, object)` — menyebarkan key object itu ke induknya.

## Relasi, dan N+1 yang bersembunyi di serialiser

`whenLoaded()` menyertakan relasi hanya kalau benar-benar sudah di-eager-load:

```ts
toArray() {
  return {
    id: this.resource.id,
    posts: this.whenLoaded('posts', () => PostResource.collection(this.resource.relations.posts)),
  }
}
```

Membaca `this.resource.posts` tanpa syarat akan menembak satu query per baris —
dari lapisan serialisasi, tempat terakhir yang orang pikir untuk di-profil. Dengan
`whenLoaded`, endpoint yang lupa `with('posts')` mengembalikan response tanpa key
itu, bukan diam-diam membuat N query.

## Meta dan envelope

```ts
UserResource.collection(users).additional({ meta: { total, page } })
// { "data": [...], "meta": { "total": 42, "page": 1 } }

UserResource.make(user).wrapIn(null)
// { "id": 1, "name": "Ada" }
```

`data` adalah envelope default, sama seperti Laravel: ia menyisakan ruang untuk
menambah `meta` atau `links` nanti tanpa merusak client yang sudah mem-parse
response. Ubah untuk satu response dengan `wrapIn(...)`, atau untuk satu kelas
dengan `static wrap = 'user'`.
