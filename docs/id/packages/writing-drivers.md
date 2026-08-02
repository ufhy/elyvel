# Menulis Driver

Setiap subsistem yang memilih implementasi berdasarkan nama — transport mail,
backend queue, cache store, disk, session store, log channel, broadcaster, driver
database, notification channel — menerima driver yang tidak pernah dikenal
framework. Kamu menerbitkan paket; tidak ada yang mengedit elyvel.

Ini mengikuti `Manager::extend()` milik Laravel, dengan alasan yang sama:
antarmukanya (`Transport`, `CacheStore`, `SessionStore`, `QueueStore`, …) memang
sudah publik sejak awal, jadi siapa pun bisa *menulis* driver. Yang butuh pintu
adalah cara *mendaftarkannya*.

## Manager: `extend()`

Mail, cache, queue, dan storage di-resolve lewat instance manager. Daftarkan dari
`boot()` sebuah service provider — driver dibangun malas, jadi apa pun yang
didaftarkan sebelum pemakaian pertama akan berlaku, dan nama yang didaftarkan
menimpa bawaan.

```ts
// app/providers/ResendServiceProvider.ts
import { ServiceProvider } from '@elyvel/core'
import { MailToken } from '@elyvel/mail'

export class ResendServiceProvider extends ServiceProvider {
  override boot(): void {
    this.app.make(MailToken).extend('resend', config => new ResendTransport(config.apiKey as string))
  }
}
```

```ts
// config/mail.ts
export default defineMailConfig({
  default: 'resend',
  mailers: { resend: { transport: 'resend', apiKey: process.env.RESEND_KEY } },
})
```

Factory menerima blok config dan nama tempat ia di-resolve. Bentuk yang sama
berlaku untuk `CacheManager.extend`, `QueueManager.extend`, dan
`FilesystemManager.extend`.

## Didaftarkan sebelum boot: session, logging, broadcasting, database

Yang ini dibangun saat framework boot, sebelum app bisa menjangkau instance mana
pun, jadi pendaftarannya lewat fungsi modul:

```ts
import { registerBroadcastDriver } from '@elyvel/broadcasting'
import { registerLogDriver, registerSessionDriver } from '@elyvel/core'
import { registerDatabaseDriver, registerGrammar } from '@elyvel/database'

registerSessionDriver('dynamodb', config => new DynamoSessionStore(config))
registerLogDriver('http', ({ config }) => [new HttpTransport(config.url)])
registerBroadcastDriver('pusher', async ({ app, config }) => new PusherBroadcaster(config))
registerDatabaseDriver('oracle', config => new OracleConnection(config))
```

Panggil saat impor di entry paketmu, atau dari `register()` sebuah provider.
Driver database juga butuh grammar untuk dialeknya —
`registerGrammar('oracle', () => new OracleGrammar())`.

## Notification channel: tanpa pendaftaran sama sekali

Channel diidentifikasi oleh kelasnya, jadi paket cukup mengekspor satu kelas dan
app menyebutnya di `via()`. Tidak ada yang perlu didaftarkan atau dikonfigurasi:

```ts
// @acme/elyvel-whatsapp
export class WhatsAppChannel {
  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    const message = notification.toWhatsApp?.(notifiable)
    if (!message)
      return
    await fetch(/* … */)
  }
}
```

```ts
class OrderShipped extends Notification {
  via() {
    return ['mail', WhatsAppChannel]
  }

  toWhatsApp() {
    return { text: 'Pesananmu sedang dikirim' }
  }
}
```

Satu instance per kelas dibuat dan dipakai ulang, jadi channel yang memegang HTTP
client atau socket hanya dibangun sekali. String dan kelas boleh dicampur dalam
satu `via()`.

## Mengetik config-nya

Union config tetap tertutup untuk bawaan — sehingga `transport: 'smpt'` tetap
typo yang ditangkap compiler, dan opsi SMTP tetap autocomplete — dengan ruang
untuk nama yang didaftarkan:

```ts
driver: 'memory' | 'file' | 'database' | 'redis' | (string & {})
```

Opsi milik driver-mu masuk sebagai bagian dari objek config; cast ke interface-mu
sendiri di dalam factory, di tempat kamu tahu bentuknya.

## Kalau namanya tidak ditemukan

Error-nya menyebut semua driver yang **ada**:

```
[elyvel] Mail transport "resnd" is not supported. Available: array, log, resend, smtp.
Register it with `MailManager.extend(name, factory)` from a provider.
```

Itu disengaja: driver yang hilang hampir selalu berarti typo atau paket yang lupa
dipasang, dan keduanya tidak terlihat dari sekadar "unsupported driver".
