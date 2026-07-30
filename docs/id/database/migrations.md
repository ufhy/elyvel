# Database: Migrasi

Migrasi adalah version control untuk skema database — setiap perubahan adalah
file bertimestamp, dan schema builder mengompilasinya ke driver mana pun yang
dikonfigurasi (SQLite, Postgres, atau MySQL). Kamu tidak pernah menulis DDL
mentah.

## Membuat migrasi

```bash
elyvel make:migration create_posts_table
```

Ini membuat file bertimestamp di `database/migrations/`:

```ts
// database/migrations/20260101000000_create_posts_table.ts
import type { Migration } from '@elyvel/database'

export default {
  up: (schema) =>
    schema.create('posts', (t) => {
      t.id()
      t.foreignId('user_id').constrained('users').cascadeOnDelete()
      t.string('title')
      t.text('body').nullable()
      t.jsonb('meta')
      t.timestampTz('published_at').nullable()
      t.softDeletes()
      t.timestamps()
    }),
  down: (schema) => schema.dropIfExists('posts'),
} satisfies Migration
```

`up` menerapkan perubahan; `down` membatalkannya. Migrasi berjalan sesuai
urutan nama file (timestamp), jadi migrasi belakangan selalu bisa
mengasumsikan migrasi sebelumnya sudah berjalan.

## Tipe kolom

Semua tipe data Postgres didukung dan dikompilasi ke tipe yang setara di
SQLite/MySQL:

- **Numerik**: `smallInteger`, `integer`, `bigInteger`, `float`, `double`, `decimal`
- **Teks**: `char`, `string`, `text`, `mediumText`, `longText`
- **Skalar lain**: `boolean`, `uuid`, `binary`
- **Tanggal/waktu**: `date`, `time`, `timestamp`, `timestampTz`, `datetime`
- **Jaringan/lain-lain**: `inet`, `cidr`, `macaddr`, `interval`
- **Terstruktur**: `json`, `jsonb`, `enum`, kolom array (`t.array('tags', 'text')`)
- **Spasial / vektor**: `geometry`, `geography`, `vector` — lihat di bawah
- **Kemudahan**: `t.id()` (primary key auto-increment), `t.foreignId('user_id')`
  (kolom FK unsigned bigint), `t.morphs('commentable')` (`commentable_id` +
  `commentable_type`, untuk relasi polymorphic)

Modifier kolom dirangkai secara fluent: `.nullable()`, `.default(value)`,
`.unique()`, `.unsigned()`, `.index()`, `.after('column')`.

### Kolom spasial dan vektor

```ts
t.geometry('area')                     // geometry apa pun
t.geometry('location', 'point')        // GEOMETRY(Point) di PG, POINT di MySQL
t.geometry('location', 'point', 4326)  // …dipatok ke sebuah SRID
t.geography('route', 'linestring')     // math sferis PostGIS
t.vector('embedding', 1536)            // pgvector / MySQL 9 — dimensi wajib
```

Postgres perlu extension-nya diaktifkan dulu (`CREATE EXTENSION IF NOT EXISTS
postgis` / `vector`); tipe spasial MySQL bersifat native, dan `VECTOR` hadir di
MySQL 9. MySQL tidak punya tipe geography terpisah, jadi `geography` menjadi kolom
spasial di sana.

::: warning SQLite tidak mendukung spasial maupun vektor
Kolomnya tetap *dibuat* — SQLite bertipe dinamis dan menerima nama tipe yang
dideklarasikan — jadi skema tetap portabel untuk dev lokal dan test. Tapi tidak
ada **fungsi** spasial atau vektor yang bekerja di sana. Yang tidak portabel
adalah query-nya, bukan skemanya.
:::

Jumlah dimensi untuk `vector` diwajibkan, bukan diberi default: pgvector maupun
MySQL membutuhkannya, dan lebar yang salah diam-diam adalah hal yang baru kamu
sadari ketika similarity search mengembalikan hasil ngawur.

### Kolom generated

Kolom yang dihitung dari sebuah ekspresi alih-alih di-assign langsung —
MySQL, Postgres, dan SQLite (3.31+) semuanya mendukung `STORED` (ditulis
fisik ke disk); hanya MySQL dan SQLite yang juga mendukung `VIRTUAL`
(dihitung saat dibaca, `virtualAs()` throw di Postgres karena tidak punya
kolom generated VIRTUAL):

```ts
t.integer('price')
t.integer('tax')
t.integer('total').storedAs('price + tax')     // STORED — semua dialek
t.integer('doubled').virtualAs('price * 2')    // VIRTUAL — MySQL/SQLite saja
```

### Index

```ts
t.index(['team_id', 'status'])           // index komposit
t.unique('email')                        // index unique standalone (lihat juga .unique() di kolom itu sendiri)
t.fullText('body')                       // MySQL FULLTEXT / Postgres GIN atas to_tsvector — lihat whereFullText()
t.fullText(['title', 'body'])            // index full-text atas beberapa kolom
t.spatialIndex('location')               // MySQL SPATIAL INDEX saja
```

`fullText()` tidak punya padanan di SQLite — `whereFullText()` tetap
bekerja di sana, cuma fallback ke pendekatan `LIKE` tanpa index untuk
mempercepatnya. `spatialIndex()` sama sekali tidak didukung di SQLite, dan
butuh ekstensi PostGIS di Postgres (tidak diasumsikan terpasang, jadi
throw di sana alih-alih diam-diam tidak melakukan apa-apa).

### Opsi tabel

```ts
schema.create('reports', (t) => {
  t.temporary()               // CREATE TEMPORARY TABLE — dihapus saat koneksi ditutup
  t.engine('InnoDB')          // MySQL/MariaDB saja
  t.charset('utf8mb4')        // MySQL/MariaDB saja
  t.collation('utf8mb4_unicode_ci') // MySQL/MariaDB saja
  t.id()
  t.string('title')
})
```

`engine()`/`charset()`/`collation()` tidak punya padanan level-tabel di
Postgres/SQLite — diam-diam diabaikan di sana alih-alih error, sama seperti
`.comment()` kolom. `temporary()` bekerja di ketiga dialek.

### Foreign key

```ts
t.foreignId('user_id').constrained('users').cascadeOnDelete()
t.foreignId('team_id').constrained().nullOnDelete() // infer nama tabel dari nama kolom
```

Perilaku delete/update lain: `.restrictOnDelete()`, `.noActionOnDelete()`,
`.cascadeOnUpdate()`.

### Timestamps, soft delete & userstamps

Tiga helper mencakup kolom "audit" yang berulang:

```ts
schema.create('posts', (t) => {
  t.id()
  t.timestamps()   // created_at, updated_at — otomatis dikelola ORM
  t.softDeletes()  // deleted_at — nullable, diisi saat delete() alih-alih menghapus row
  t.userstamps()   // created_by, updated_by, deleted_by — FK nullable ke users(id)
})
```

`t.userstamps(usersTable?)` defaultnya ke tabel `users`; berikan nama lain
jika tabel user aplikasimu berbeda nama. Lihat [Eloquent: Memulai](/id/database/eloquent#userstamps)
untuk cara kolom-kolom ini otomatis terisi dari user pada request saat ini.

## Mengubah tabel

```ts
export default {
  up: (schema) =>
    schema.table('posts', (t) => {
      t.string('slug').nullable()        // tambah kolom
      t.text('body').nullable().change() // ubah tipe kolom yang sudah ada (pg saja)
      t.renameColumn('title', 'headline')
      t.dropColumn('legacy')
      t.dropIndex('idx_posts_title')
    }),
  down: (schema) => schema.table('posts', (t) => t.dropColumn('slug')),
} satisfies Migration

// Ganti nama seluruh tabel
schema.rename('old_table', 'new_table')
```

`change()` dan `dropForeign()` hanya untuk Postgres — SQLite tidak bisa
mengubah tipe kolom atau drop kolom yang menjadi bagian foreign key secara
in-place; rebuild tabelnya sebagai gantinya. `dropUserstamps()` mengikuti
aturan yang sama (SQLite melempar error yang jelas); di MySQL, constraint
FK-nya dicari dan di-drop otomatis sebelum kolomnya, karena MySQL (berbeda
dari Postgres) menolak men-drop kolom yang masih direferensikan olehnya.

## Menjalankan migrasi

```bash
elyvel migrate            # jalankan semua migrasi yang pending
elyvel migrate:fresh      # drop semua tabel lalu jalankan ulang dari awal
elyvel migrate:rollback   # rollback batch migrasi terakhir
elyvel migrate:status     # tampilkan migrasi mana saja yang sudah berjalan
elyvel db:seed            # jalankan database seeder
elyvel schema:dump        # squash skema saat ini jadi satu file SQL
```

### Squashing migrasi

Begitu sebuah proyek menumpuk ratusan migrasi, menjalankannya ulang dari awal —
di CI, atau untuk developer baru — jadi lambat dan makin rapuh. `schema:dump`
menulis struktur saat ini ke satu file:

```bash
elyvel schema:dump              # → database/schema/default-schema.sql
elyvel schema:dump --prune      # …dan hapus file migrasi yang sudah tercakup
```

`elyvel migrate` memuat file itu otomatis ketika database-nya belum pernah
dimigrasi, lalu hanya menjalankan migrasi yang ditulis *setelah* dump. Dump-nya
membawa baris applied-migration-nya sendiri, jadi tidak ada yang dijalankan ulang
di atas skema yang sudah terbangun.

`--prune` hanya menghapus migrasi yang benar-benar sudah **diterapkan** — yang
masih pending adalah pekerjaan yang tidak ada di dalam dump, jadi ia dibiarkan.

Di Postgres dan MySQL strukturnya dibaca dengan `pg_dump`/`mysqldump` (seperti
Laravel), jadi binary-nya harus ada di `PATH` dan `DATABASE_URL` harus di-set;
perintahnya gagal dengan alasannya, bukan menulis file setengah jadi. SQLite tidak
butuh apa pun dari luar — DDL-nya langsung dari `sqlite_master`.

### Lock migrasi

Migrasi memegang sebuah row lock di dalam database itu sendiri, jadi dua
proses tidak bisa migrasi bersamaan — kasus paling umumnya beberapa
instance yang boot bersamaan di rolling deploy. Proses yang menemukan lock
sedang dipegang akan throw `MigrationLockError` alih-alih mengembalikan
"tidak ada yang perlu dimigrasi", supaya pemanggil bisa membedakan antara
*tidak perlu jalan* dan *tidak boleh jalan*:

```ts
import { migrate, MigrationLockError } from '@elyvel/database'

try {
  await migrate(conn, dir)
}
catch (e) {
  if (e instanceof MigrationLockError) {
    // instance lain sedang migrasi — aman untuk lanjut boot
  }
}
```

Lock yang ditinggalkan proses yang mati di tengah migrasi otomatis diambil
alih setelah 10 menit; `elyvel migrate:unlock` membersihkannya lebih cepat
(lakukan hanya kalau kamu yakin tidak ada migrasi yang sungguh berjalan —
ia juga mengambil alih lock yang masih hidup).

## Memeriksa database

```bash
elyvel db                     # buka shell native (sqlite3 / psql)
elyvel db:show                # daftar tabel beserta jumlah row
elyvel db:table users         # deskripsikan kolom sebuah tabel
elyvel db:monitor --max=100   # jumlah koneksi terbuka (Postgres)
```

## Event

Jembatani event lifecycle migrasi ke `@elyvel/events` (pola injectable yang
sama seperti bridge event model Eloquent) — `migrations.started`/
`migrations.ended` terpicu sekali per panggilan
`migrate()`/`rollback()`/`reset()`, `migration.started`/`migration.ended`
terpicu per migrasi individual:

```ts
import { configureMigrationEventDispatcher } from '@elyvel/database'
import { event } from '@elyvel/events'

configureMigrationEventDispatcher((name, payload) => event(name, payload))
```

```ts
listen('migration.started', ({ name, direction }) => {
  logger.info(`Menjalankan ${direction === 'down' ? 'rollback' : 'migrasi'}: ${name}`)
})
```

`payload` adalah `{ names, direction }` untuk event level-batch dan `{ name,
direction }` untuk yang per-migrasi (`direction` adalah `'up'` atau
`'down'`). Tidak ada yang terpicu saat `--pretend` — memang tidak ada
migrasi sungguhan yang berjalan saat itu.
