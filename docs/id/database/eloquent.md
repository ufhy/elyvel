# Eloquent: Memulai

Eloquent adalah Active Record ORM milik elyvel: setiap model memetakan ke
sebuah tabel, dan sebuah instance memetakan ke sebuah row. Berjalan tanpa
perubahan di SQLite, Postgres, atau MySQL — mengganti database cukup ubah
config, bukan menulis ulang.

## Konfigurasi

Koneksi berada di `config/database.ts`; mengganti koneksi aktif cukup dengan
mengubah `default`:

```ts
// config/database.ts
import { defineDatabaseConfig } from '@elyvel/database'

export default defineDatabaseConfig({
  default: process.env.DB_CONNECTION ?? 'sqlite',
  connections: {
    sqlite: { driver: 'sqlite', database: 'database/database.sqlite' },
    pglite: { driver: 'pglite', dataDir: 'database/pglite' }, // Postgres embedded, tanpa server
    pg: { driver: 'pg', url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/app' },
  },
})
```

Driver: `bun:sqlite` (bawaan), `@electric-sql/pglite` (Postgres embedded,
WASM), `postgres` (server Postgres asli, peer dependency opsional), dan
`mysql` (MySQL/MariaDB via `kysely` + `mysql2`, keduanya peer dependency
opsional).

Di luar aplikasi framework, konek langsung tanpa service provider:

```ts
import { createConnection, setConnection } from '@elyvel/database'

const conn = await createConnection({ driver: 'sqlite', database: ':memory:' })
setConnection(conn) // menjadi koneksi default yang dipakai model
```

## Mendefinisikan model

```ts
import { Model } from '@elyvel/database'

export class User extends Model {
  static override table = 'users'
  static override hidden = ['password']         // tidak pernah diserialisasi
  static override casts = { id: 'int', phone: 'encrypted' } as const

  declare id: number
  declare name: string
  declare email: string
  declare password: string
  declare phone: string | null

  // relasi adalah method biasa
  posts() {
    return this.hasMany(Post)
  }
}
```

Static yang bisa di-override: `table`, `primaryKey`, `timestamps`,
`connection`, `hidden`, `visible`, `appends`, `casts`, `accessors`, `scopes`,
`fillable`, `guarded`, `softDeletes`, `deletedAtColumn`, `usesUniqueIds`,
`userstamps`, `createdByColumn`, `updatedByColumn`, `deletedByColumn`.

Kemudahan lain: `Model.findMany(ids)`, `Model.whereKey(id)`,
`Model.withoutTimestamps(fn)`, `query.sole()`, `instance.replicate()`,
`instance.touch()`. Set `static usesUniqueIds = true` untuk otomatis membuat
primary key UUID saat create (override `static newUniqueId()` untuk ULID).

## CRUD

```ts
const user = await User.create({ name: 'Ada', email: 'ada@example.com' })

user.name = 'Ada Lovelace'
await user.save()

await user.update({ email: 'ada@lovelace.dev' })
await user.delete()

const found = await User.find(1)
const orFail = await User.findOrFail(1)
const ada = await User.where('email', 'ada@example.com').first()
const all = await User.all()

await User.firstOrCreate({ email: 'a@b.c' }, { name: 'A' })
await User.updateOrCreate({ email: 'a@b.c' }, { name: 'A2' })
```

## Query builder

Gunakan lewat model (`User.query()`) atau berdiri sendiri tanpa model, mirip
`DB::table()` di Laravel — bentuk standalone mengembalikan row mentah dan
bisa menargetkan koneksi bernama mana pun:

```ts
import { table } from '@elyvel/database'

const rows = await table('users').where('active', true).orderByDesc('id').get()
await table('logs', 'analytics').count() // argumen kedua = nama koneksi

// pagination juga tersedia di raw builder
const page = await table('users').orderBy('id').paginate(15, 1)
await table('users').cursorPaginate(15, cursor)

// iterasi lazy / keyset
for await (const row of table('users').cursor()) { /* ... */ }
await table('users').chunkById(1000, (rows) => { /* ... */ })
```

Seluruh method tersedia di `table()` maupun `Model.query()`: `whereNot`,
`orWhereNull`, `whereLike`,
`whereDate`/`whereYear`/`whereMonth`/`whereDay`/`whereTime`,
`whereBetweenColumns`, `whereJsonContains`, `rightJoin`/`crossJoin`/closure
join, `inRandomOrder`, `reorder`, `groupByRaw`, `havingBetween`, `unionAll`,
`skip`/`take`, `addSelect`, `truncate`, `incrementEach`, `doesntExist`, `find`.

**Subquery** didukung di mana pun — select, from, join, dan where:

```ts
const teamB = table('teams').select('id').where('title', 'B')
await table('users').whereIn('team_id', teamB).get()          // where … in (subquery)

await table('users')
  .selectSub(table('orders').selectRaw('count(*)'), 'orders')  // scalar select subquery
  .get()

await table('t').fromSub(table('users').where('score', '>', 60), 't').get() // from (subquery)
await table('users').joinSub(teamB, 'tb', 'tb.id', '=', 'users.team_id').get()
```

```ts
const rows = await User.query()
  .select('id', 'name')
  .where('active', true)
  .whereIn('role', ['admin', 'staff'])
  .whereNotNull('email_verified_at')
  .orWhere(q => q.where('vip', true).whereBetween('score', [90, 100]))
  .join('teams', 'teams.id', '=', 'users.team_id')
  .groupBy('team_id')
  .having('count', '>', 1)
  .orderByDesc('created_at')
  .limit(20)
  .get()

// Agregat
await User.query().count()
await User.query().where('active', true).sum('score')

// Helper penulisan
await User.query().where('id', 1).increment('logins')
await User.query().insertMany([{ name: 'A' }, { name: 'B' }])
await User.query().upsert([{ email: 'a@b.c', name: 'A' }], ['email'], ['name'])

// Escape hatch
.whereRaw('lower(email) = ?', ['ada@x.io'])
.selectRaw('count(*) as n')
```

SQL mentah langsung ke koneksi — binding posisional atau bernama, plus
`unprepared` untuk DDL multi-statement:

```ts
import { raw, unprepared } from '@elyvel/database'

await raw('SELECT * FROM users WHERE id = :id', { id: 1 }) // :name → ? / $n
await raw('SELECT * FROM users WHERE age > ?', [18])
await unprepared('CREATE TABLE a (id INT); CREATE TABLE b (id INT);')
```

Tersedia juga: `distinct`, `whereColumn`, `whereExists`, `leftJoin`,
`orderByRaw`, `union`, `lockForUpdate`, `sharedLock`, `when`, `pluck`,
`value`, `chunk`, `insertOrIgnore`, `updateOrInsert`, `decrement`.

## Relasi

```ts
class User extends Model {
  posts()   { return this.hasMany(Post) }
  profile() { return this.hasOne(Profile) }
  roles()   { return this.belongsToMany(Role) }        // via pivot
}
class Post extends Model {
  user()     { return this.belongsTo(User) }
  comments() { return this.morphMany(Comment, 'commentable') }
}
```

Kumpulan lengkap: `hasOne`, `hasMany`, `belongsTo`, `belongsToMany`,
`hasOneThrough`, `hasManyThrough`, `morphOne`, `morphMany`, `morphTo`,
`morphToMany`, `morphedByMany`. Pivot mendukung `withPivot`,
`withTimestamps`, dan `attach` / `detach` / `sync`.

### Eager loading

```ts
const users = await User.query().with('posts').get()
const posts = users.first()?.getRelation('posts') // tanpa N+1

await User.query().with('posts.comments').get()            // nested
await User.query().with({ posts: q => q.where('published', true) }).get() // dengan constraint

// Agregat tanpa memuat row
await User.query().withCount('posts').get()   // → user.getAttribute('posts_count')
await User.query().withSum('posts', 'views').get()

// Filter keberadaan
await User.query().has('posts').get()
await User.query().whereHas('posts', q => q.where('published', true)).get()
await User.query().doesntHave('posts').get()

// Lazy load ke instance yang sudah ada
await user.load('posts')
await user.loadMissing('profile')
```

## Casts

```ts
static override casts = {
  id: 'int',
  active: 'boolean',
  meta: 'json',
  published_at: 'datetime',
  phone: 'encrypted',              // AES-256-GCM, butuh config('app.key')
  slug: { get: v => String(v).toLowerCase() }, // accessor/mutator custom
} as const
```

Tipe bawaan: `int`, `float`, `boolean`, `string`, `json`, `array`, `date`,
`datetime`, `encrypted`. Cast `encrypted` menyimpan ciphertext di database
(`iv:tag:ciphertext`, base64) dan mengembalikan nilai yang sudah didekripsi
saat dibaca.

## Pagination

```ts
const page = await User.query().orderBy('id').paginate(15, 1)
// { data, total, perPage, currentPage, lastPage }

await User.query().simplePaginate(15) // tanpa COUNT — { data, hasMore }
await User.query().cursorPaginate(15, cursor) // keyset pagination
```

Untuk me-render link prev/next/bernomor dari hasil `paginate()` di
sebuah [view](/id/digging-deeper/views), lihat `paginationLinks()`.

## Soft delete & scope

```ts
class Post extends Model {
  static override softDeletes = true
}

await post.delete()        // set deleted_at
await post.restore()
post.trashed()             // boolean

await Post.query().withTrashed().get()
await Post.query().onlyTrashed().get()
```

Global scope berlaku untuk setiap query pada model tersebut:

```ts
Post.addGlobalScope('published', qb => qb.where('published', true))
```

## Event model & observer

Setiap save/delete melewati lifecycle penuh berisi event bernama:
`saving`/`saved`, `creating`/`created`, `updating`/`updated`,
`deleting`/`deleted`, `trashed`, `forceDeleting`/`forceDeleted`,
`restoring`/`restored`, `retrieved`, `replicating`, `pruning`. Dengarkan
satu secara langsung:

```ts
Post.on('created', (post) => {
  console.log('post baru:', post.id)
})
```

Kelompokkan handler terkait ke dalam sebuah **observer** alih-alih
menyebar pemanggilan `.on()` — object (atau class) apa pun yang nama
method-nya cocok dengan nama event:

```ts
// app/observers/PostObserver.ts
export class PostObserver {
  creating(post: Post) {
    post.slug ??= Str.slug(post.title)
  }

  deleted(post: Post) {
    logger.info(`post ${post.id} dihapus`)
  }
}
```

```ts
Post.observe(PostObserver)
```

Atau pasang langsung di class dengan decorator `@ObservedBy` alih-alih
pemanggilan `observe()` terpisah:

```ts
@ObservedBy(PostObserver)
class Post extends Model { /* ... */ }
```

Event model tetap berada di dalam proses secara default — mereka tidak
lewat [`@elyvel/events`](/id/digging-deeper/events) kecuali kamu
menjembataninya secara eksplisit:

```ts
import { event } from '@elyvel/events'
import { configureModelEventDispatcher } from '@elyvel/database'

configureModelEventDispatcher((name, model) => event(name, model))
// sekarang: listen('eloquent.created: Post', (post) => { ... })
```

## Userstamps

Otomatis mengisi `created_by`/`updated_by`/`deleted_by` dari user yang
sedang login pada request saat ini, sama seperti `timestamps` otomatis
mengisi `created_at`/`updated_at`:

```ts
class Post extends Model {
  static override userstamps = true
}
```

```ts
// database/migrations/..._create_posts_table.ts
await schema.create('posts', (t) => {
  t.id()
  t.string('title')
  t.timestamps()
  t.softDeletes()
  t.userstamps()   // created_by/updated_by/deleted_by nullable, FK ke users(id)
})
```

`created_by`/`updated_by` diisi saat create, `updated_by` diperbarui di
setiap update, dan `deleted_by` diisi saat soft delete lalu dikosongkan saat
restore. Di luar request yang terautentikasi (queued job, seeder, script),
isi actor secara manual dengan `runWithActor`:

```ts
import { runWithActor } from '@elyvel/core'

await runWithActor(userId, () => Post.create({ title: 'From a job' }))
```

`t.userstamps(usersTable?)` (lihat [Migrasi](/id/database/migrations#timestamps-soft-delete-userstamps))
defaultnya ke tabel `users`; berikan nama tabel lain jika tabel user
aplikasimu berbeda nama. Nama kolom bisa dikustomisasi per-model lewat
`createdByColumn`/`updatedByColumn`/`deletedByColumn` (default
`created_by`/`updated_by`/`deleted_by`).

## Transaksi

```ts
import { transaction } from '@elyvel/database'

await transaction(async () => {
  const user = await User.create({ name: 'Ada' })
  await Post.create({ user_id: user.id, title: 'Hello' })
  // COMMIT jika sukses, ROLLBACK jika ada error yang di-throw
})

// Retry saat deadlock / serialization failure
await transaction(async () => { /* ... */ }, 3)

// Transaksi nested memakai SAVEPOINT — rollback di dalam tidak membatalkan yang di luar
await transaction(async () => {
  await User.create({ name: 'outer' })
  await transaction(async () => {
    await User.create({ name: 'inner' }) // di-rollback ke savepoint-nya saat throw
  })
})

// Kontrol manual
import { beginTransaction, commit, rollBack } from '@elyvel/database'
await beginTransaction()
try {
  // ...
  await commit()
}
catch (e) {
  await rollBack()
  throw e
}
```

## Model pruning

Hapus record yang sudah usang secara batch — jadwalkan `elyvel model:prune`
lewat cron.

```ts
class PersonalAccessToken extends Model {
  static override prunable() {
    return this.query()
      .whereNotNull('expires_at')
      .where('expires_at', '<', new Date().toISOString())
  }
}
```

```bash
elyvel model:prune                       # prune semua model prunable
elyvel model:prune PersonalAccessToken   # prune satu model
```

`prune(chunkSize = 1000)` memicu event `pruning` per record (hook untuk
membersihkan resource terkait) dan menghapus permanen row yang cocok,
termasuk yang sudah soft-deleted.

## Pemisahan koneksi read/write

Arahkan pembacaan ke replica dan penulisan (serta apa pun di dalam
transaksi) ke primary. Pembacaan di dalam transaksi juga selalu ke primary,
supaya sebuah query melihat tulisannya sendiri yang belum di-commit.

```ts
// config/database.ts
pgSplit: {
  driver: 'pg',
  url: process.env.DATABASE_URL, // fallback
  write: { url: 'postgres://primary:5432/app' },
  read: [
    { url: 'postgres://replica-1:5432/app' },
    { url: 'postgres://replica-2:5432/app' }, // round-robin
  ],
  sticky: true, // setelah write, arahkan pembacaan request itu ke primary
}
```

`sticky` memberikan read-your-writes per HTTP request (di-scope dengan
`AsyncLocalStorage`); pembacaan di dalam transaksi selalu memakai primary
apa pun kondisinya.

## Query logging & monitoring

Log manual, in-memory (mirip `DB::enableQueryLog()` di Laravel):

```ts
const conn = useConnection()
conn.enableQueryLog()
await User.all()
conn.getQueryLog() // [{ sql, bindings, ms }]
```

Event hook (mirip `DB::listen()` di Laravel), bisa dipakai standalone atau
disambungkan ke logger:

```ts
const off = conn.onQuery(({ sql, bindings, ms }) => { /* ... */ })
conn.onQueryError(({ sql, bindings, error }) => { /* ... */ })
conn.whenQueryingForLongerThan(500, ({ ms }) => { /* slow request */ })
```

Di aplikasi framework, `EloquentServiceProvider` otomatis menyambungkan ini
ke channel `sql` milik logger:

- **Query error** selalu di-log (`sql`, `bindings`, `error`, `stack`) —
  konteks yang kamu butuhkan untuk melacak kegagalan.
- Set `log: true` di `config/database.ts` untuk juga mencatat setiap query
  di level `debug`.
- Set `slowMs: <ms>` untuk warning saat total waktu query per-request
  melebihi batas tersebut.

Lihat [`examples/basic-app`](https://github.com/ufhy/elyvel/tree/main/examples/basic-app)
untuk contoh aplikasi nyata yang memakai model, migrasi, seeder, casts
terenkripsi, dan pruning end-to-end.
