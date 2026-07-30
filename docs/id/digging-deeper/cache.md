# Cache

API cache yang tidak terikat pada store tertentu — mirip facade `Cache` di
Laravel. Ganti `memory` ke `file`/`database`/`redis` lewat config tanpa
menyentuh satu pun call site.

## Konfigurasi

```ts
// config/cache.ts
import { defineCacheConfig } from '@elyvel/cache'

export default defineCacheConfig({
  default: process.env.CACHE_STORE ?? 'memory',
  stores: {
    memory: { driver: 'memory' },
    file: { driver: 'file', path: 'storage/framework/cache' },
    database: { driver: 'database' }, // butuh tabel `cache` (disambungkan EloquentServiceProvider)
    redis: { driver: 'redis', url: process.env.REDIS_URL, prefix: 'cache:' },
  },
})
```

`memory` tidak butuh entri config — selalu tersedia dan dipakai sebagai
fallback jika `default` tidak diset.

## Menyimpan & mengambil

```ts
import { cache } from '@elyvel/cache'

await cache().put('key', value, 60)     // detik; kosongkan untuk "selamanya"
await cache().forever('key', value)
const value = await cache().get('key', 'default')

await cache().has('key')
await cache().missing('key')
await cache().add('key', value, 60)     // hanya menyimpan jika key belum ada — return apakah disimpan
await cache().pull('key')               // get + forget sekaligus
await cache().forget('key')
await cache().flush()                   // hapus seluruh store

await cache().increment('hits')
await cache().decrement('hits')

cache('redis') // store bernama tertentu, bukan yang default
```

## `remember`

Pola umum "ambil dari cache, atau hitung lalu simpan":

```ts
const users = await cache().remember('users.active', 300, () => User.where('active', true).get())

await cache().rememberForever('site.settings', () => Settings.first())
```

Pemanggil konkuren yang berebut key yang sama saat cold/expired digabungkan
dalam satu proses — hanya pemanggil pertama yang benar-benar menjalankan
factory; sisanya menunggu hasilnya, alih-alih semuanya membebani sumber data
asli (thundering herd saat key populer expired). View bertag
(`cache().tags(...).remember(...)`) mendapat coalescing yang sama.

::: tip `add` dan `pull` atomik — dengan satu catatan
`add()` adalah guard sekali-jalan (kirim-email-ini-sekali,
dispatch-job-ini-sekali) dan `pull()` membaca nilai sekali-pakai, jadi
keduanya lewat satu operasi store yang tak terbagi, bukan pasangan
baca-lalu-tulis: tepat satu pemanggil konkuren mendapat `true` dari `add()`,
dan tepat satu menerima nilainya dari `pull()`.

Catatannya soal *cakupan*. `redis` atomik lintas proses (`SET NX` /
`GETDEL`). `memory` dan `file` atomik di dalam satu proses — cukup untuk
satu instance, tapi dua instance yang menunjuk direktori cache yang sama
masih bisa sama-sama menang, limitasi yang sama seperti `increment` di
driver file. `database` butuh adapter yang mengimplementasikan `add` (satu
`INSERT … ON CONFLICT DO NOTHING`); tanpa itu ia turun jadi pasangan
baca-lalu-tulis. Di tempat jaminannya memang harus dipegang lintas instance,
pakai `redis`, unique constraint database, atau dukungan unique-job milik
queue.

`increment()` tidak membuat atau menyegarkan window: key yang masih hidup
mempertahankan expiry yang sudah ada, dan increment pada key yang TTL-nya
sudah lewat memulai counter baru **tanpa** expiry (sama seperti `INCRBY`
Redis). Jadi counter yang ingin kamu reset berkala perlu window-nya
dibangun ulang — `put()` key-nya dengan TTL, atau pakai
[Rate Limiting](/id/digging-deeper/rate-limiting), yang mengelolanya
untukmu. Kalau kamu menulis adapter `database` sendiri, perhatikan bahwa
`increment` atomik opsionalnya harus memperlakukan row yang expired sebagai
tidak ada; lihat docstring `CacheDbAdapter` untuk satu statement yang
melakukannya.
:::

## Tag

Kelompokkan entri terkait supaya bisa di-invalidate bersama, tanpa
menyentuh cache lainnya (mirip `Cache::tags(...)` di Laravel):

```ts
await cache().tags(['posts', `post:${post.id}`]).put('rendered', html, 3600)

// Nanti, saat post berubah:
await cache().tags([`post:${post.id}`]).flush() // hanya entri di bawah tag ini
```

Tag bekerja sama persis di semua store (memory/file/database/redis) —
setiap tag punya version id, dan flush cukup merotasi version-nya, sehingga
entri lama menjadi tak terjangkau dan expired sendiri sesuai TTL-nya,
bukan di-enumerasi lalu dihapus satu per satu.

## Atomic lock

Sebuah mutex di atas cache, supaya hanya satu proses menjalankan sepotong
pekerjaan pada satu waktu — `Cache::lock()` milik Laravel. Bentuk yang sebaiknya
dipakai memberi callback, karena ia tidak bisa membocorkan lock saat return lebih
awal atau saat throw:

```ts
await cache().lock('rebuild-sitemap', 300).acquire(() => rebuildSitemap())
```

`acquire()` tidak menunggu — ia langsung mengembalikan `false` kalau lock-nya
sedang dipegang, dan callback-nya tidak dijalankan. Untuk menunggu, pakai
`block()`:

```ts
// Tunggu maksimal 10 detik, lalu menyerah
await cache().lock('import-feed', 120).block(10, () => importFeed())
```

`block()` akan **throw** `LockTimeoutError` ketika waktunya habis, bukan
mengembalikan `false` yang gampang terabaikan. Tanpa callback, `acquire()`
mengembalikan boolean dan `release()` jadi tanggung jawabmu:

```ts
const lock = cache().lock('import-feed', 120)
if (await lock.acquire()) {
  try { await importFeed() }
  finally { await lock.release() }
}
```

### Kepemilikan, dan kenapa release bisa mengembalikan false

Setiap acquisition menyimpan owner token acak, dan `release()` menghapus lock-nya
hanya jika token itu masih ada. Jadi `release()` yang mengembalikan `false`
berarti **TTL-mu sudah lewat dan sekarang lock-nya dipegang orang lain** —
pekerjaanmu berjalan lebih lama daripada proteksi yang menaunginya. Itu layak
di-log.

Inilah inti dari pemeriksaan kepemilikan: tanpa itu, pemegang yang kelamaan akan
menghapus lock yang sudah sah diambil peer, lalu menyerahkannya ke pemanggil
ketiga sementara peer-nya masih mengira lock itu miliknya. (Scheduler mutex milik
framework ini sendiri pernah punya bug persis seperti itu.)

::: warning TTL itu penjaga terhadap crash, bukan jaring pengaman
TTL wajib ada — `lock(name, 0)` akan throw — karena lock yang pemegangnya crash
harus bisa kedaluwarsa sendiri, kalau tidak operasinya macet selamanya. Set
dengan longgar di atas durasi pekerjaan sebenarnya. Kalau pekerjaannya rutin
melewati TTL, naikkan TTL-nya; jangan mengandalkan expiry untuk mengakhiri
critical section.
:::

`forceRelease()` melepas lock tanpa peduli pemiliknya. Ia akan dengan senang hati
merenggut lock yang sedang diandalkan proses lain, jadi simpan untuk
membersihkan lock yang terlantar karena crash.

### Melepas dari proses lain

Bawa owner token-nya dan bangun ulang lock-nya di tempat pekerjaan itu selesai —
kasus queued job, di mana request yang acquire dan worker yang release:

```ts
const lock = cache().lock('process-upload', 600)
if (await lock.acquire())
  await dispatch(new ProcessUpload(uploadId, lock.owner()))

// …di dalam job-nya
await cache().restoreLock('process-upload', this.lockOwner, 600).release()
```

### Dukungan store

Lock butuh dua operasi atomik: acquire-jika-belum-ada dan compare-and-delete.
Keempat store bawaan menyediakannya — `memory` dan `file` dalam satu proses,
`redis` lewat `SET NX` plus compare-and-delete berbasis Lua, `database` lewat
adapter-nya. Store custom yang kehilangan salah satunya akan throw saat kamu
memanggil `lock()`, bukan menyerahkan lock yang bisa dipegang dua pemanggil
sekaligus.

::: warning Hanya redis (dan database store dengan `forgetIf`) yang mengunci lintas instance
Lock `memory` dan `file` bersifat per-proses — dua instance di belakang load
balancer masing-masing punya lock sendiri. Store `database` jatuh ke
read-then-delete saat release kecuali adapter-nya mengimplementasikan `forgetIf`,
dan itu bisa melepas lock yang sudah diambil peer. Untuk distributed lock yang
sesungguhnya, pakai `redis`.
:::

## Memilih store

| Driver | Catatan |
| --- | --- |
| `memory` | Per-proses, reset saat restart/redeploy. Cocok untuk dev, test, atau aplikasi single-instance. |
| `file` | Bertahan lewat restart; tidak dibagi antar beberapa instance aplikasi. |
| `database` | Dibagi antar instance; menambah satu query per operasi. |
| `redis` | Dibagi, cepat, dan satu-satunya driver dengan TTL native (tidak ada key yang perlu di-sweep). |
