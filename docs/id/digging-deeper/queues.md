# Queue

Pindahkan pekerjaan yang lambat atau tidak reliable — mengirim email,
memanggil API pihak ketiga, memproses upload — keluar dari siklus
request/response. Sebuah job di-dispatch secara instan; proses worker
terpisah yang mengambil dan menjalankannya.

## Konfigurasi

```ts
// config/queue.ts
import { defineQueueConfig } from '@elyvel/queue'

export default defineQueueConfig({
  default: process.env.QUEUE_CONNECTION ?? 'sync',
  connections: {
    sync: { driver: 'sync' },         // berjalan inline, tanpa worker — cocok untuk dev lokal
    database: { driver: 'database' }, // butuh tabel `jobs` (disambungkan EloquentServiceProvider)
    redis: { driver: 'redis', url: process.env.REDIS_URL, queue: 'queues' },
  },
})
```

Empat driver: `sync` (tanpa queue sama sekali — langsung jalan di dalam
proses), `memory` (queue in-process sungguhan, berguna untuk test),
`database`, dan `redis`. `sync` tidak bisa dikerjakan oleh `queue:work` —
tidak ada apa pun yang bisa di-poll.

## Membuat job

Job adalah class biasa yang meng-extend `Job` dengan method `handle()`.
Field constructor publik menjadi payload job yang diserialisasi:

```ts
// app/jobs/SendWelcomeEmail.ts
import { Job } from '@elyvel/queue'

export class SendWelcomeEmail extends Job {
  constructor(public userId: number) {
    super()
  }

  async handle(): Promise<void> {
    const user = await User.findOrFail(this.userId)
    await Mail.to(user.email).send(new WelcomeMail(user))
  }

  async failed(error: unknown): Promise<void> {
    // dipanggil sekali setelah retry habis
  }
}
```

Daftarkan setiap class job sekali saat boot supaya worker bisa
merekonstruksi instance dari payload yang diserialisasi berdasarkan nama
class:

```ts
// app/jobs/index.ts (di-import config/app.ts atau service provider)
import { registerJob } from '@elyvel/queue'
import { SendWelcomeEmail } from './SendWelcomeEmail'

registerJob(SendWelcomeEmail /* , ...class job lainnya */)
```

Field retry/perilaku pada job: `tries` (default 1), `backoff` (detik, atau
array untuk delay yang meningkat per attempt), `timeout`, `maxExceptions`.

## Men-dispatch job

```ts
import { dispatch, dispatchSync } from '@elyvel/queue'

await dispatch(new SendWelcomeEmail(user.id))

// Opsi: delay (detik), koneksi bernama, lane queue bernama
await dispatch(new SendWelcomeEmail(user.id), {
  delay: 60,
  connection: 'redis',
  queue: 'emails',
})

// Jalankan langsung, melewati queue sepenuhnya (misal di test)
await dispatchSync(new SendWelcomeEmail(user.id))
```

Fungsi biasa juga bisa di-dispatch, tanpa subclass `Job` — closure-nya
diserialisasi (harus self-contained, tidak boleh menangkap variabel dari
luar):

```ts
await dispatch(() => console.log('jalan di worker'))
```

### Chaining job

Rangkai job supaya job berikutnya hanya jalan setelah job sebelumnya sukses:

```ts
const job = new ProcessUpload(fileId)
job.chain([new GenerateThumbnails(fileId), new NotifyOwner(fileId)])
await dispatch(job)
```

### Dispatch setelah transaksi database commit

Berikan `afterCommit: true` (butuh `configureAfterCommit` disambungkan saat
boot) untuk menunda dispatch sampai transaksi yang membungkusnya benar-benar
commit — menghindari worker mengambil job yang mereferensikan row yang
justru di-rollback transaksinya.

## Job middleware

Sebuah job bisa mendeklarasikan middleware lewat `middleware():
JobMiddleware[]`, berjalan di sekeliling `handle()`:

```ts
import { Job, RateLimited, WithoutOverlapping } from '@elyvel/queue'

export class GenerateReport extends Job {
  constructor(public teamId: number) { super() }

  middleware() {
    return [
      new WithoutOverlapping(`report:${this.teamId}`, { releaseAfter: 60 }),
      new RateLimited(`reports`, { maxAttempts: 10, perSeconds: 60 }),
    ]
  }

  async handle(): Promise<void> { /* ... */ }
}
```

`WithoutOverlapping` mencegah job kedua dengan key yang sama berjalan
bersamaan — job yang berebut dilepas kembali ke queue alih-alih dijalankan.
`RateLimited` membatasi seberapa sering job dengan key yang sama boleh
berjalan. Keduanya butuh store yang dikonfigurasi sekali saat boot
(`configureUniqueJobs`, `configureRateLimiter`) — implementasi in-memory
(per-proses) atau berbasis Redis (dibagi antar worker) tersedia bawaan.

### Unique jobs

Mekanisme terpisah yang lebih sederhana untuk "jangan enqueue lagi kalau
sudah ada yang pending" — set `unique = true` (opsional override
`uniqueId()` untuk key dedupe custom, dan `uniqueFor` untuk berapa lama lock
bertahan, default 3600 detik):

```ts
export class SyncInventory extends Job {
  static override unique = true
  uniqueId() { return 'inventory-sync' }
}
```

Dispatch duplikat selagi lock masih berlaku akan diam-diam diabaikan; lock
dilepas saat job selesai (sukses atau gagal final).

## Job batching

Dispatch sekelompok job bersamaan dan lacak progress keseluruhannya:

```ts
import { Bus, findBatch } from '@elyvel/queue'

const batch = await Bus.batch([
  new ImportRow(1),
  new ImportRow(2),
  new ImportRow(3),
])
  .name('csv-import')
  .onQueue('imports')
  .then(batch => console.log('semua selesai'))
  .catch((batch, error) => console.log('ada job yang gagal', error))
  .finally(batch => console.log('batch settled'))
  .dispatch()

batch.total      // 3
batch.progress() // 0–100

// Nanti, dari mana saja:
const current = await findBatch(batch.id)
current.processed // total - pending
current.finished  // boolean
```

`.allowFailures()` membiarkan job yang tersisa tetap berjalan setelah satu
gagal (default: kegagalan membatalkan sisa batch dan langsung lompat ke
`.catch()`). Callback diserialisasi seperti closure yang di-queue — jaga
agar tetap self-contained. Butuh `configureBatches(...)` disambungkan saat
boot (berbasis memory atau Redis).

## Menjalankan queue worker

```bash
elyvel queue:work                          # proses koneksi/queue default selamanya
elyvel queue:work --queue=high,default      # poll queue sesuai urutan prioritas
elyvel queue:work --once                    # proses tepat satu job, lalu keluar
elyvel queue:work --stop-when-empty         # keluar setelah queue kosong
elyvel queue:work --sleep=3 --max=100       # interval poll, dan batas jumlah job
```

Jalankan ini sebagai proses long-lived tersendiri (terpisah dari web server)
di production — driver `database`/`redis` yang memungkinkan hal ini. `sync`
tidak bisa dikerjakan (tidak ada queue untuk di-poll).

Restart semua worker yang berjalan secara graceful setelah deploy —
`queue:restart` memberi sinyal ke worker untuk keluar setelah menyelesaikan
job yang sedang berjalan, bukan mematikannya di tengah job:

```bash
elyvel queue:restart
```

## Menangani job yang gagal

Saat sebuah job menghabiskan `tries`-nya, ia dicatat (koneksi, queue,
payload yang diserialisasi persis, dan error-nya) alih-alih hilang begitu
saja:

```bash
elyvel queue:failed                # daftar job yang gagal
elyvel queue:retry <id>            # dorong ulang ke queue aslinya
elyvel queue:retry --all           # retry semuanya
elyvel queue:forget <id>           # hapus satu record gagal
elyvel queue:flush                 # hapus semua record gagal
elyvel queue:prune-failed --hours=24
```

## Event job

Hook di seluruh proses, berguna untuk logging/metrik tanpa menyentuh setiap
job:

```ts
import { Queue } from '@elyvel/queue'

Queue.before(name => console.log(`memulai ${name}`))
Queue.after(name => console.log(`selesai ${name}`))
Queue.failing((name, error) => console.log(`${name} gagal`, error))
```

Jika `@elyvel/events` terpasang, ini juga terpicu sebagai event biasa
(`queue.processing`, `queue.processed`, `queue.failed`) — `listen('queue.failed', ...)`
bekerja tanpa `@elyvel/queue` bergantung langsung pada package events.

## Meng-queue event listener

Listener yang seharusnya jalan di queue alih-alih inline tidak butuh
penulisan job ekstra — implementasikan listener seperti biasa dan daftarkan
dengan `registerListener(...)` (di samping `registerJob`) alih-alih framework
menjalankannya secara sinkron.

## Serialisasi model

Field job yang menyimpan instance model Eloquent tidak diserialisasi sebagai
snapshot mentah — ia didehidrasi menjadi referensi ringan `{ model, id }`
sebelum ditulis ke queue, lalu diambil ulang segar dari database tepat
sebelum `handle()` berjalan. Artinya job yang di-dispatch dengan model
terlampir selalu melihat state *terkini* model tersebut di worker, bukan
salinan basi dari saat ia di-queue.
