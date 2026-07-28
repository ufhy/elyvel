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

```bash
elyvel make:job SendWelcomeEmail
```

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

Buat middleware sendiri dengan mengimplementasikan `JobMiddleware` — satu
method `handle(job, next)`, dipanggil di sekeliling `handle()` job:

```ts
import type { Job, JobMiddleware } from '@elyvel/queue'
import { ReleaseJob } from '@elyvel/queue'

class LogDuration implements JobMiddleware {
  async handle(job: Job, next: () => Promise<void>): Promise<void> {
    const start = Date.now()
    await next()
    console.log(`${job.constructor.name} butuh ${Date.now() - start}ms`)
  }
}
```

Lempar `new ReleaseJob(delaySeconds)` di dalam `handle()` untuk melepas job
kembali ke queue tanpa menghitung percobaan itu sebagai kegagalan (yang
dilakukan `WithoutOverlapping`/`RateLimited` secara internal saat
berebut) — worker menangkapnya dan meng-queue ulang setelah
`delaySeconds`.

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

Ini butuh store bersama yang disambungkan lewat
`configureRestartSignal(...)` — beda dari rate limiter atau scheduler
mutex, tidak ada default in-memory di sini, karena sinyal in-memory hanya
akan terlihat oleh proses worker yang memanggil `configureRestartSignal`,
bukan oleh invocation CLI `queue:restart` yang terpisah yang mencoba
menjangkaunya:

```ts
import { configureRestartSignal, RedisRestartSignal } from '@elyvel/queue'

configureRestartSignal(new RedisRestartSignal(redisClient))
```

Tanpa ini disambungkan, `queue:restart` melaporkan bahwa signalling
restart belum dikonfigurasi.

### Meng-embed worker secara programatik

`elyvel queue:work` adalah wrapper tipis di atas class `Worker` yang sama
yang bisa kamu pakai langsung — untuk test harness, process manager
custom, atau meng-embed loop worker di dalam program yang lebih besar:

```ts
import { Worker } from '@elyvel/queue'

const worker = new Worker(store, {
  connection: 'default',
  queues: ['high', 'default'],
  failed: failedJobs(),
  onBeforeJob: name => console.log(`memulai ${name}`),
  onAfterJob: name => console.log(`selesai ${name}`),
  onError: (name, error, willRetry) => console.log(`${name} gagal`, error, { willRetry }),
})

const processed = await worker.work({ once: true }) // atau stopWhenEmpty/sleepMs/max
```

`store` adalah `QueueManager.store(connection)` yang sama yang di-resolve
CLI — `app.make(QueueToken).store(connection)` di dalam app yang sudah
di-boot. `worker.processNext()` juga tersedia langsung kalau kamu mau
menjalankan loop-nya sendiri alih-alih memanggil `.work()`.

## Menangani job yang gagal

Saat sebuah job menghabiskan `tries`-nya, ia dicatat (koneksi, queue,
payload yang diserialisasi persis, dan error-nya) alih-alih hilang begitu
saja — aktifkan dengan `configureFailedJobs(adapter)` saat boot;
`MemoryFailedJobStore` tersedia bawaan (mirip failed-send store
`@elyvel/mail`):

```ts
import { configureFailedJobs, MemoryFailedJobStore } from '@elyvel/queue'

configureFailedJobs(new MemoryFailedJobStore())
```

Tanpa ini disambungkan, job yang gagal habis hanya di-log, tidak
disimpan, jadi perintah CLI di bawah ini tidak ada isinya:

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

Jika `@elyvel/events` terpasang, ini juga bisa terpicu sebagai event biasa
(`queue.processing`, `queue.processed`, `queue.failed`) setelah kamu
menyambungkannya saat boot — `@elyvel/queue` tetap tidak bergantung pada
`@elyvel/events`, jadi ini satu panggilan wiring, bukan otomatis:

```ts
import { configureQueueEventDispatcher } from '@elyvel/queue'
import { event } from '@elyvel/events'

configureQueueEventDispatcher((name, payload) => event(name, payload))
```

Setelah itu, `listen('queue.failed', ...)` bekerja seperti event lainnya.

## Meng-queue event listener

Listener yang seharusnya jalan di queue alih-alih inline tidak butuh
penulisan job ekstra — implementasikan listener seperti biasa dan daftarkan
dengan `registerListener(...)` (di samping `registerJob`) alih-alih framework
menjalankannya secara sinkron.

## Serialisasi model

Opsional: field job yang menyimpan instance model Eloquent bisa didehidrasi
menjadi referensi ringan `{ model, id }` sebelum ditulis ke queue, lalu
diambil ulang segar dari database tepat sebelum `handle()` berjalan —
sehingga job yang di-dispatch dengan model terlampir melihat state
*terkini* model tersebut di worker, bukan salinan basi dari saat ia
di-queue. Ini butuh `configureModelSerializer(...)` disambungkan saat
boot; tanpa itu, field model diserialisasi apa adanya (snapshot mentah
dari attribute-nya saat dispatch):

```ts
import { Model } from '@elyvel/database'
import { configureModelSerializer } from '@elyvel/queue'

configureModelSerializer({
  dehydrate: value => (value instanceof Model ? { model: value.constructor.name, id: value.getKey() } : undefined),
  hydrate: ref => modelRegistry[ref.model]?.find(ref.id) ?? null,
})
```

`modelRegistry` di sini terserah kamu — sebuah `Record<string, typeof Model>`
kecil yang memetakan nama class kembali ke class model-nya, karena payload
job hanya menyimpan namanya sebagai string.
