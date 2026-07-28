# Maintenance Mode

Bawa aplikasi offline dengan `503` untuk semua orang kecuali secret
bypass yang kamu kontrol — deploy migrasi tanpa request setengah jalan
menyentuh skema yang setengah termigrasi.

## Pemakaian dasar

```bash
elyvel down
elyvel down --secret=my-bypass-token --retry=60 --message="Upgrading the database"
elyvel up
```

`--secret` polos (tanpa value) men-generate dan mencetak satu secara acak
untukmu. Kunjungi `/?secret=<token>` di browser untuk mengatur cookie
bypass untuk browser itu — setiap pengunjung lain tetap melihat halaman
maintenance sampai `elyvel up`. `--retry` mengatur header `Retry-After`
(detik); `--status` mengubah kode response (default `503`).

Lihat [Referensi CLI](/id/guide/cli-reference) untuk setiap flag.

## Bagaimana ini diterapkan

`maintenanceMode(file)` adalah plugin global yang di-mount sebelum setiap
route; ia membaca state down secara segar di **setiap request** (bukan
cuma sekali saat boot), jadi perubahan state selama masa hidup aplikasi
(proses lain menjalankan `elyvel down`, atau pemanggilan
`configureMaintenanceStore` belakangan) langsung berlaku tanpa restart.
Sebuah request mendapat JSON atau HTML tergantung content negotiation,
sama seperti penanganan error framework lainnya.

## Deployment multi-instance

Secara default, state maintenance adalah file di disk lokal — `elyvel
down` yang dijalankan terhadap satu instance hanya membawa instance itu
down; load balancer tetap mengarahkan ke yang lain, dan aplikasi diam-diam
tetap "up" untuk kebanyakan pengunjung selama jendela outage tersebut.
Sambungkan ke store bersama sebagai gantinya:

```ts
import { configureMaintenanceStore, RedisMaintenanceStore } from '@elyvel/core'

configureMaintenanceStore(new RedisMaintenanceStore(redisClient))
```

Setiap instance yang berbagi Redis itu sekarang melihat state down/up yang
sama — seluruh aplikasi benar-benar down, bukan cuma instance yang
kebetulan dijalankan CLI-nya.

## API programatik

```ts
import { bringDown, bringUp, isDownForMaintenance, readDownPayload } from '@elyvel/core'

bringDown(downFilePath, { message: 'Scheduled maintenance', retryAfter: 120 })
isDownForMaintenance(downFilePath) // boolean
readDownPayload(downFilePath) // DownPayload | null
bringUp(downFilePath)
```

Ini adalah operasi file level rendah yang dipanggil command CLI itu
sendiri — berguna jika kamu ingin memicu maintenance mode dari script atau
deploy hook milikmu sendiri alih-alih menjalankan `elyvel down`.

`resetMaintenanceStore()` mengosongkan store yang dikonfigurasi kembali ke
fallback file — terutama untuk test.
