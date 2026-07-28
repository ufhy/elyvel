# Database: Seeding

Isi database dengan data test/demo — factory menghasilkan instance model
yang realistis, seeder mengorkestrasi pembuatannya.

## Mendefinisikan factory

Factory adalah fungsi, bukan class yang di-extend — `defineFactory(Model,
definition)` mengembalikan sebuah factory-creator:

```ts
// database/factories/PostFactory.ts
import { defineFactory } from '@elyvel/database'
import { faker } from '@faker-js/faker'
import { Post } from '../../app/models/Post'

export const postFactory = defineFactory(Post, (i) => {
  const title = faker.lorem.sentence({ min: 4, max: 8 }).replace(/\.$/, '')
  return {
    title,
    slug: `${faker.helpers.slugify(title).toLowerCase()}-${i}`,
    body: faker.lorem.paragraphs(3, '\n\n'),
  }
})

export default postFactory
```

`definition` adalah `(index: number) => attributes`, dipanggil sekali per
row — `index` adalah posisi 0-based row tersebut di dalam sebuah batch,
berguna untuk membuat tiap row unik (suffix bernomor, tanggal yang
diberi jarak).

::: tip Faker tidak dibundel
Tidak ada generator fake-data bawaan — pasang
[`@faker-js/faker`](https://fakerjs.dev) sendiri (`bun add -d
@faker-js/faker`) dan import per file factory, seperti di atas. `elyvel
make:factory` men-scaffold import-nya dalam keadaan di-comment.
:::

Hanya kembalikan kolom yang fillable/mass-assignable dari definition —
field yang dipercaya, server-only saja (id user pemilik, flag
`published`) sebaiknya berasal dari `overrides` yang dilewatkan saat
pemanggilan sebagai gantinya, karena row hasil factory lewat
`Model.create()` dan aturan `fillable`/`guarded` normalnya.

## Memakai factory

```ts
import { postFactory } from '../database/factories/PostFactory'

const post = await postFactory().createOne({ user_id: user.id })

const posts = await postFactory().count(5).create({ user_id: user.id })

// Bangun instance yang belum disimpan — tanpa penulisan DB, berguna di unit test
const draft = postFactory().makeOne({ title: 'Fixed title' })
```

`count(n)` mengatur ukuran batch (default 1); `overrides` digabung ke
setiap row yang di-generate dalam batch itu (object overrides yang sama
untuk masing-masing — overrides yang berbeda per row berasal dari apa
yang dihitung `definition(index)` sendiri). `create()`/`createOne()`
menyimpan lewat `Model.create()` (casts, aturan fillable, dan observer
`creating`/`created` semua tetap berlaku); `make()`/`makeOne()` membangun
instance yang belum disimpan sebagai gantinya.

## Relasi

Tidak ada API factory yang sadar relasi (tidak ada `.for(...)`) — buat
parent-nya dulu lalu lewatkan id-nya ke overrides factory anak:

```ts
const posts = await postFactory().count(5).create({ user_id: author.id })
for (const post of posts) {
  await commentFactory().count(2).create({ post_id: post.id })
}
```

## State factory

Juga tidak ada builder `.state(name, overrides)` — tulis variasinya
manual setelah membuat, atau dengan object `overrides` berbeda per
pemanggilan:

```ts
const posts = await postFactory().count(5).create({ user_id: author.id })
const [scheduled, ...published] = posts

for (const post of published) {
  post.published = true
  await post.save()
}
```

## Mendefinisikan seeder

```ts
// database/seeders/BlogSeeder.ts
import { Seeder } from '@elyvel/database'
import { postFactory } from '../factories/PostFactory'

export class BlogSeeder extends Seeder {
  override async run(): Promise<void> {
    await postFactory().count(5).create({ user_id: 'seed-author' })
  }
}

export default BlogSeeder
```

Extend `Seeder` dan implementasikan `run()`. Panggil seeder lain dari
dalamnya dengan `this.call(SeederClass)` — lewatkan class-nya sendiri,
bukan instance:

```ts
// database/seeders/DatabaseSeeder.ts
import { Seeder } from '@elyvel/database'
import { BlogSeeder } from './BlogSeeder'

export class DatabaseSeeder extends Seeder {
  override async run(): Promise<void> {
    await this.call(BlogSeeder)
    // await this.call(UsersSeeder)
  }
}

export default DatabaseSeeder
```

## Entry point `DatabaseSeeder`

`elyvel db:seed` (dan `migrate:fresh --seed`/`migrate:refresh --seed`)
selalu mencari tepat satu file: `database/seeders/DatabaseSeeder.ts`,
default-export sebuah subclass `Seeder`. Jika hilang, CLI memberitahumu
untuk membuat satu: `elyvel make:seeder Database`. Susun setiap seeder
lain dari dalam `run()`-nya lewat `this.call(...)` — tidak ada flag
`--class=` untuk menjalankan seeder lain langsung dari CLI.

## Menjalankan seeder

```bash
elyvel db:seed                 # menjalankan DatabaseSeeder
elyvel migrate:fresh --seed    # drop semua, migrasi ulang, lalu seed
elyvel migrate:refresh --seed  # rollback + migrasi ulang, lalu seed
```

Secara programatik (dari script atau test):

```ts
import { runSeeders } from '@elyvel/database'
import { DatabaseSeeder } from '../database/seeders/DatabaseSeeder'

await runSeeders([DatabaseSeeder])
```

`runSeeders(classes)` menginstansiasi dan menjalankan masing-masing
secara berurutan — berguna untuk menjalankan cuma satu seeder tertentu
tanpa lewat `DatabaseSeeder`.

## Bukan `seed` yang sama dengan `@elyvel/testing`

`refreshDatabase({ seed })` milik `@elyvel/testing` (lihat
[HTTP Test](/id/digging-deeper/testing#isolasi-database)) berbagi kata
"seed" tapi merupakan **konsep yang berbeda dan tidak terkait** — callback
`seed` itu membangun schema mentah (menjalankan migrasi) di koneksi baru,
sama sekali tidak memanggil sistem Factory/Seeder ini. Untuk memakai
factory/seeder sungguhan di sebuah test, jalankan secara eksplisit
sesudahnya:

```ts
await refreshDatabase({ seed: conn => migrate(conn, migrationsDir) })
await runSeeders([DatabaseSeeder]) // atau cukup: await postFactory().count(3).create()
```
