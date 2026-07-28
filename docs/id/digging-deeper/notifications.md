# Notifikasi

Kirim satu notifikasi lewat satu atau beberapa channel — mail, record
database in-app, Telegram — tanpa kode pemanggil perlu tahu bagaimana
masing-masing channel benar-benar mengirimkannya.

## Mendefinisikan notifikasi

Extend `Notification` dan implementasikan `via()` untuk menyatakan channel
mana yang dipakai notifikasi ini; implementasikan method `to<Channel>()`
untuk masing-masing yang kamu sebutkan:

```ts
// app/notifications/InvoicePaid.ts
import { Notification, type Notifiable } from '@elyvel/notifications'
import { Message } from '@elyvel/mail'

export class InvoicePaid extends Notification {
  constructor(private amount: number) {
    super()
  }

  via(notifiable: Notifiable): string[] {
    return ['mail', 'database']
  }

  toMail(notifiable: Notifiable): Message {
    return new Message().subject('Invoice paid').text(`We received your payment of $${this.amount}.`)
  }

  toDatabase(notifiable: Notifiable): Record<string, unknown> {
    return { amount: this.amount }
  }
}
```

Implementasikan hanya method `to*` untuk channel yang benar-benar
di-return dari `via()` — yang tidak diimplementasikan cukup dilewati
untuk channel tersebut.

## Bentuk `Notifiable`

Apa pun bisa menerima notifikasi — tidak ada base model class yang perlu
di-extend, cukup interface biasa:

```ts
interface Notifiable {
  routeNotificationFor?(channel: string): string | number | undefined
  getKey?(): unknown
  id?: unknown
}
```

`routeNotificationFor(channel)` menyediakan alamat per-channel (email untuk
`mail`, chat id untuk `telegram`) saat `toMail()`/`toTelegram()` sebuah
notifikasi tidak mengaturnya secara eksplisit. `getKey()` (fallback ke
`.id`) mengidentifikasi row untuk channel `database`. Object literal biasa
sama validnya dengan model Eloquent:

```ts
const user = {
  id: 7,
  routeNotificationFor: (channel: string) => (channel === 'mail' ? 'ada@example.com' : undefined),
}
```

## Mengirim notifikasi

```ts
import { notify } from '@elyvel/notifications'

await notify(user, new InvoicePaid(49))

// satu notifikasi, banyak penerima
await notify([userA, userB], new InvoicePaid(49))
```

Jika satu channel throw, sisanya tetap berjalan — kegagalan dikumpulkan dan
dicatat (lihat [Testing](#testing) di bawah) alih-alih membatalkan
pengiriman ke semua channel lain. Hal yang sama berlaku antar beberapa
notifiable: satu penerima gagal tidak menghentikan yang lain untuk
dinotifikasi.

## Channel

| Channel | Dikirim lewat | Catatan |
| --- | --- | --- |
| `mail` | `mailManager()` milik `@elyvel/mail` | Fallback ke `routeNotificationFor('mail')` jika `Message` dari `toMail()` tidak mengatur `to`. |
| `telegram` | `telegram()` milik `@elyvel/telegram` | `toTelegram()` mengembalikan string atau structured message; chat id di-resolve dengan fallback yang sama. |
| `database` | adapter yang disediakan aplikasi | Lihat di bawah — butuh `configureDatabaseNotifications(...)`. |
| `array` | in-memory | Test double — lihat [Testing](#testing). |

Daftarkan channel tambahanmu sendiri dengan interface `Channel` yang sama
(`send(notifiable, notification): Promise<void>`):

```ts
import { notifications } from '@elyvel/notifications'

notifications().channel('slack', new SlackChannel())
```

Di dalam channel custom, `routeFor`/`notifiableKey` mencerminkan apa yang
dilakukan `mail`/`telegram` secara internal untuk menentukan tujuan
notifikasi dan untuk siapa:

```ts
import type { Channel, Notifiable, Notification } from '@elyvel/notifications'
import { notifiableKey, routeFor } from '@elyvel/notifications'

class SlackChannel implements Channel {
  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    const webhookUrl = routeFor(notifiable, 'slack')     // notifiable.routeNotificationFor('slack')
    const id = notifiableKey(notifiable)                  // notifiable.getKey?.() ?? notifiable.id
    // ... post ke webhookUrl, log berdasarkan `id`, dst.
  }
}
```

Tidak ada channel `broadcast` bawaan — `toBroadcast()` dideklarasikan pada
`Notification` sebagai stub untuk aplikasi menyambungkannya sendiri.

## Notifikasi database

Channel `database` butuh adapter yang tahu cara menyimpan row notifikasi:

```ts
import { configureDatabaseNotifications } from '@elyvel/notifications'

configureDatabaseNotifications({
  async insert(record) {
    await DatabaseNotification.create({
      id: record.id,
      type: record.type,
      notifiable_id: record.notifiableId,
      data: record.data,
      read_at: record.readAt,
      created_at: record.createdAt,
    })
  },
})
```

Package ini sengaja dibuat DB-agnostic — tidak ada tabel/migrasi
`notifications`, model, atau query scope `markAsRead`/`unread` bawaan.
Definisikan tabelnya dan query read/unread-nya sendiri (model dengan
konvensi mirip `userstamps` sudah cukup); adapter di atas adalah satu-
satunya titik integrasi yang dibutuhkan package ini.

## Queueing

`Notification` tidak punya flag queue sendiri — untuk mengirim di luar
siklus request/response, bungkus pemanggilan `notify()` di dalam sesuatu
yang sudah bisa di-queue: sebuah [queue job](/id/digging-deeper/queues),
atau [queued event listener](/id/digging-deeper/events#queued-listener):

```ts
export class SendCommentNotification extends QueuedListener<CommentPosted> {
  async handle(event: CommentPosted): Promise<void> {
    await notify({ id: event.post.userId }, new NewCommentNotification(event))
  }
}
```

## Testing

Tidak ada `Notification::fake()`. Daftarkan channel `array` dan periksa apa
yang terkumpul sebagai gantinya:

```ts
import { ArrayChannel, notifications } from '@elyvel/notifications'

const array = new ArrayChannel()
notifications().channel('array', array)
// ... jalankan kode yang diuji ...
array.sent // [{ notifiable, notification, data }, ...]
```

`setDefaultNotifications(manager)` mengganti `NotificationManager`
default untuk seluruh proses sepenuhnya — berguna untuk membangun
manager baru dengan hanya channel yang dibutuhkan sebuah test, alih-alih
mengkonfigurasi ulang yang sungguhan di tempat.

Pengiriman yang gagal (channel mana pun yang `send()`-nya throw) dicatat
terpisah jika kamu opt-in dengan `configureFailedNotifications(adapter)` —
`MemoryFailedNotificationStore` tersedia bawaan sebagai default, memberi
visibilitas ke kegagalan pengiriman per-channel tanpa API assertion penuh.
Baca kembali dengan `failedNotifications()`:

```ts
import { failedNotifications } from '@elyvel/notifications'

await failedNotifications()?.all()
await failedNotifications()?.find(id)
await failedNotifications()?.forget(id)
await failedNotifications()?.flush()
await failedNotifications()?.prune(24) // lebih tua dari 24 jam
```
