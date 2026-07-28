# Event

Observer pattern sederhana: dispatch sebuah event, dan setiap listener yang
terdaftar untuknya akan berjalan. Berguna untuk memisahkan efek samping
(mengirim notifikasi, menghapus cache, mencatat audit trail) dari kode yang
memicunya.

## Mendefinisikan event

Tidak ada base class atau decorator yang perlu di-extend — class biasa apa
pun bisa jadi event. Nama constructor-nya menjadi key dispatch, dan field
publiknya menjadi payload yang diterima listener:

```ts
// app/events/CommentPosted.ts
export class CommentPosted {
  constructor(
    public readonly comment: Comment,
    public readonly post: Post,
  ) {}
}
```

## Mendaftarkan listener

Listener adalah fungsi biasa, atau object/class dengan method `handle(event,
name)`:

```ts
import { listen } from '@elyvel/events'

listen(CommentPosted, (event) => {
  console.log(`Komentar baru di post ${event.post.id}`)
})
```

Listener untuk event yang sama berjalan sesuai urutan pendaftaran;
me-return `false` dari salah satunya menghentikan sisanya untuk dispatch
itu. Listener wildcard (key `'*'`) terpicu untuk setiap event dan juga
menerima nama event yang teresolusi:

```ts
listen('*', (event, name) => console.log(`terpicu: ${name}`))
```

Event bernama string juga bisa dipakai, untuk sinyal ad-hoc yang tidak
butuh class:

```ts
listen('cache.cleared', payload => console.log(payload))
```

## Men-dispatch event

```ts
import { event } from '@elyvel/events'

await event(new CommentPosted(comment, post))
await event('cache.cleared', { store: 'redis' })
```

`event()` mengembalikan return value setiap listener sebagai array
(melewati yang null/undefined) — berguna saat listener menghitung sesuatu
yang ingin diambil balik oleh titik dispatch. `Dispatcher.until(event)`
menjalankan listener sesuai urutan dan langsung berhenti begitu salah satu
mengembalikan nilai non-null, memotong sisanya — padanan Laravel untuk
"listener pertama yang menjawab, menang".

## `EventServiceProvider`

Daftarkan setiap pemetaan event → listener di satu tempat, saat boot:

```ts
// app/providers/EventServiceProvider.ts
import type { EventKey, Listener } from '@elyvel/events'
import { EventServiceProvider as BaseEventServiceProvider } from '@elyvel/events'
import { CommentPosted } from '../events/CommentPosted'
import { SendCommentNotification } from '../listeners/SendCommentNotification'

export class EventServiceProvider extends BaseEventServiceProvider {
  protected override listen: Array<[EventKey, Listener[]]> = [
    [CommentPosted, [new SendCommentNotification()]],
  ]
}
```

Tambahkan ke `providers` di `config/app.ts` seperti service provider
lainnya.

## Event subscriber

Untuk class yang ingin mendaftarkan beberapa listener terkait sekaligus,
alih-alih mencantumkannya satu per satu di `EventServiceProvider`,
implementasikan `Subscriber`:

```ts
import type { Dispatcher, Subscriber } from '@elyvel/events'

class AuditSubscriber implements Subscriber {
  subscribe(dispatcher: Dispatcher): void {
    dispatcher.listen(UserRegistered, e => audit('user.registered', e))
    dispatcher.listen(UserDeleted, e => audit('user.deleted', e))
  }
}

dispatcher.subscribe(new AuditSubscriber())
```

## Queued listener

Listener yang seharusnya tidak memblokir request (mengirim notifikasi,
memanggil API yang lambat) meng-extend `QueuedListener` alih-alih menjadi
object biasa — inilah opt-in ke queue, padanan `ShouldQueue` di Laravel:

```ts
// app/listeners/SendCommentNotification.ts
import { QueuedListener } from '@elyvel/events'

export class SendCommentNotification extends QueuedListener<CommentPosted> {
  async handle(event: CommentPosted): Promise<void> {
    await notify({ id: event.post.user_id }, new NewCommentNotification(event))
  }
}
```

Daftarkan class-nya dengan `registerListener(...)` milik `@elyvel/queue`
(di samping pemanggilan `registerJob(...)`-mu) supaya worker — proses
terpisah — bisa merekonstruksinya dari job yang diserialisasi:

```ts
import { registerListener } from '@elyvel/queue'

registerListener(SendCommentNotification)
```

Hook opsional pada `QueuedListener`: `shouldQueue(event)` (return `false`
untuk menjalankan inline untuk event tertentu ini), `viaConnection()`,
`viaQueue()`, `withDelay(event)`, dan `failed(event, error)`. Extend
`QueuedListenerAfterCommit` alih-alih untuk menunda queueing sampai
transaksi database yang membungkusnya commit. Tanpa `@elyvel/queue`
terpasang dan tersambung (yang memanggil `configureListenerQueuer` saat
boot), `QueuedListener` cukup berjalan inline — tidak ada yang rusak,
hanya saja tidak ditunda.

## Testing

Ganti dengan dispatcher perekam supaya event yang di-dispatch tidak benar-
benar menjalankan listener-nya, lalu assert apa yang *akan* terpicu:

```ts
import { fakeEvents, restoreEvents } from '@elyvel/events'

const fake = fakeEvents()
await someAction()
fake.assertDispatched(CommentPosted)
fake.assertNotDispatched(UserDeleted)
restoreEvents() // kembali ke dispatcher asli
```

## Event model

Hook lifecycle model Eloquent (`creating`/`created`/`updating`/`saved`/
`deleting`/`deleted`/...) adalah mekanisme terpisah dan berdiri sendiri —
lihat [Eloquent: Memulai](/id/database/eloquent) dan `Model.observe()`.
Secara default mereka tidak lewat dispatcher ini, meski sebuah aplikasi
bisa menjembataninya dengan `configureModelEventDispatcher(...)` jika ingin
perubahan lifecycle model juga terpicu sebagai event biasa.
