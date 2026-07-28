# Service Container

Setiap binding di-key oleh sebuah **token** yang bertipe, bukan string —
me-resolve token mengembalikan tipe persis yang dideklarasikan, tanpa
cast, tanpa facade, tanpa `any` yang bocor ke kode aplikasi. Ini sengaja
lebih sempit dari container Laravel: tidak ada auto-resolution/injection
berbasis reflection, tidak ada contextual binding, tidak ada tagging, dan
tidak ada alias — filosofi "no runtime magic" elyvel berarti setiap
binding adalah kode eksplisit yang bisa kamu telusuri, bukan sesuatu yang
di-infer dari tipe parameter constructor.

## Token

```ts
import { token } from '@elyvel/core'

interface Mailer { send(to: string, body: string): Promise<void> }
const MailerToken = token<Mailer>('mailer')
```

Token cuma `{ key: string }` dengan phantom type — `key` adalah yang
benar-benar dipakai container untuk menyimpan binding; parameter tipe
hanya ada saat compile time, supaya `make()` mengembalikan tipe yang
benar.

## Binding, dari service provider

Setiap app punya `container` (`Application.container`), dijangkau dari
`this.app.container` di dalam `ServiceProvider`. `register()` adalah
tempat binding didaftarkan — `boot()` berjalan setelah `register()` semua
provider, jadi aman me-resolve service di sana, tapi tidak di dalam
`register()` provider lain:

```ts
// app/providers/MailServiceProvider.ts
import { ServiceProvider } from '@elyvel/core'
import { MailerToken } from '../tokens'
import { SmtpMailer } from '../mail/SmtpMailer'

export class MailServiceProvider extends ServiceProvider {
  register(): void {
    this.app.container.singleton(MailerToken, app => new SmtpMailer(app.config.get('mail')))
  }

  async boot(): Promise<void> {
    const mailer = this.app.make(MailerToken) // aman di sini — register() semua provider sudah jalan
    await mailer.send('ops@example.com', 'App booted')
  }
}
```

`app.make(token)` (dipakai di atas) adalah shorthand untuk
`app.container.make(token)`.

## Method binding

```ts
container.bind(Token, app => new Thing())        // nilai baru di setiap make()
container.singleton(Token, app => new Thing())    // di-resolve sekali, lalu di-cache
container.instance(Token, alreadyBuiltThing)      // daftarkan nilai yang sudah kamu punya

container.bindIf(Token, factory)                  // hanya kalau belum di-bind
container.singletonIf(Token, factory)

container.has(Token)                              // sudah di-bind (factory atau instance)?
container.bound(Token)                             // alias dari has()

container.forget(Token)                            // hapus satu binding + instance cache-nya
container.flush()                                   // hapus semuanya (terutama untuk test)
```

Factory menerima container itu sendiri, jadi sebuah binding bisa
bergantung pada binding lain:

```ts
container.singleton(MailerToken, app => new SmtpMailer(app.make(ConfigToken)))
```

## Resolving

```ts
const mailer = container.make(MailerToken) // bertipe Mailer, tanpa cast
```

Throw kalau token tidak pernah di-bind — pesan error menyebut nama
token-nya supaya kamu tahu provider mana yang hilang.

## Mendekorasi service yang sudah di-bind

`extend()` membungkus nilai yang sudah di-bind setelah di-resolve — untuk
mendekorasi sebuah service tanpa mendaftar ulang seluruh binding-nya
(misalnya membungkus logger untuk menambah metrics, membungkus mailer
untuk mode dry-run saat testing):

```ts
container.extend(MailerToken, (mailer, app) => {
  return app.config.get('app.env') === 'testing' ? new DryRunMailer(mailer) : mailer
})
```

Untuk binding `singleton`/`instance`, decorator berjalan sekali — segera
kalau nilainya sudah di-resolve, atau di waktu berikutnya ia dibangun —
dan nilai yang dibungkus itulah yang di-cache. Untuk `bind` biasa, ia
berjalan segar di setiap `make()`, karena nilai segar memang diproduksi
setiap kali. Beberapa panggilan `extend()` pada token yang sama berlaku
sesuai urutan pendaftarannya.

## Testing

`container.flush()` di antara test membersihkan semua binding dan
instance yang di-cache, jadi `Container` baru (atau boot app baru) mulai
bersih — berguna kalau sebuah test perlu mendaftar ulang fake sebagai
pengganti binding asli (`container.instance(MailerToken, fakeMailer)`).
