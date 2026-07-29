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

::: warning `add` dan `pull` tidak atomik
Keduanya adalah baca lalu tulis dengan `await` di antaranya, jadi dua
pemanggil konkuren untuk key yang sama bisa sama-sama "menang": `add()` bisa
mengembalikan `true` dua kali, dan `pull()` bisa menyerahkan nilai one-shot
yang sama ke dua pemanggil. Jangan bangun guard sekali-jalan (kirim-email-ini-
sekali, dispatch-job-ini-sekali) atau token sekali-pakai hanya di atasnya —
pakai unique constraint database, atau dukungan unique-job milik queue, di
tempat jaminannya memang harus dipegang.

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

## Memilih store

| Driver | Catatan |
| --- | --- |
| `memory` | Per-proses, reset saat restart/redeploy. Cocok untuk dev, test, atau aplikasi single-instance. |
| `file` | Bertahan lewat restart; tidak dibagi antar beberapa instance aplikasi. |
| `database` | Dibagi antar instance; menambah satu query per operasi. |
| `redis` | Dibagi, cepat, dan satu-satunya driver dengan TTL native (tidak ada key yang perlu di-sweep). |
