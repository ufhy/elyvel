# Mail

API fluent yang tidak terikat transport tertentu untuk mengirim email.
Arahkan ke SMTP di production dan `log` di development, tanpa mengubah satu
pun call site.

## Konfigurasi

```ts
// config/mail.ts
import { defineMailConfig } from '@elyvel/mail'

export default defineMailConfig({
  default: process.env.MAIL_MAILER ?? 'log',
  from: {
    email: process.env.MAIL_FROM ?? 'no-reply@example.com',
    name: process.env.APP_NAME ?? 'App',
  },
  mailers: {
    log: { transport: 'log' },   // menulis ke logger — default untuk dev
    smtp: {
      transport: 'smtp',
      host: process.env.MAIL_HOST ?? 'localhost',
      port: Number(process.env.MAIL_PORT ?? 1025),
      secure: false,
    },
  },
})
```

Tiga transport tersedia bawaan: `log` (default dev, menulis ke logger
alih-alih benar-benar mengirim), `array` (mengumpulkan pesan yang terkirim
di memory — lihat [Testing](#testing) di bawah), dan `smtp` (pengiriman
sungguhan lewat `nodemailer`, peer dependency opsional). `from` adalah
pengirim fallback yang dipakai kapan pun sebuah pesan tidak menentukan
pengirimnya sendiri.

## Mengirim email

Cara tercepat — tanpa perlu class `Mailable`:

```ts
import { Mail } from '@elyvel/mail'

await Mail.to('ada@example.com')
  .subject('Welcome')
  .html('<h1>Hi Ada</h1>')
  .send()

// cc / bcc / pengirim tertentu, semuanya chainable
await Mail.to('ada@example.com')
  .cc({ email: 'team@example.com', name: 'Team' })
  .bcc('audit@example.com')
  .from({ email: 'hello@example.com', name: 'App' })
  .subject('Welcome')
  .html('<h1>Hi Ada</h1>')
  .send()

// mailer selain default
await Mail.mailer('smtp').to('ada@example.com').subject('Hi').text('Hello').send()
```

## Class Mailable

Untuk apa pun yang dipakai berulang atau punya logika nyata di baliknya,
extend `Mailable` dan atur semuanya pada `Message` yang diberikan:

```ts
// app/mail/WelcomeMail.ts
import { Mailable, Message } from '@elyvel/mail'

export class WelcomeMail extends Mailable {
  constructor(private name: string) {
    super()
  }

  build(message: Message): void {
    message.subject('Welcome').html(`<h1>Hi ${this.name}</h1>`)
  }
}
```

```ts
await Mail.to(user.email).send(new WelcomeMail(user.name))
```

Hanya ada satu method `build()` — tidak ada pemisahan envelope/content
terpisah. Penerima bisa diatur baik lewat `Mail.to(...)` di call site,
maupun di dalam `build()` lewat `message.to(...)`, mana pun yang lebih
masuk akal untuk mailable tersebut.

## View untuk body HTML

`.html(...)` menerima string biasa, atau apa pun yang punya method
`render()` — template `@elyvel/view` yang sudah dikompilasi langsung
di-render ke dalam body:

```ts
message.html(view('emails/welcome', { name: this.name }))
```

Karena email dikirim di luar konteks HTTP request, data shared template
yang biasanya didapat view dari request (session, token CSRF, flash) tidak
tersedia — itu semua masuk sebagai default kosong sebagai gantinya.

## Attachment

```ts
message.attach({
  filename: 'invoice.pdf',
  content: pdfBytes,             // string atau Uint8Array
  contentType: 'application/pdf',
})
```

Belum ada shortcut `@elyvel/storage` atau API inline/embedded-image — baca
sendiri bytes filenya lalu attach langsung.

## Pengiriman yang gagal

Pengiriman yang throw akan dicatat (nama mailer, ringkasan `{ to, cc, bcc,
subject }`, dan error-nya) sebelum error-nya di-rethrow — opt-in dengan
`configureFailedMail(adapter)` saat boot; `MemoryFailedMailStore` tersedia
bawaan sebagai default. Ini mirroring failed-job store milik
`@elyvel/queue`, jadi kegagalan tidak diam-diam hilang meski tanpa setup
monitoring mail yang lengkap.

## Testing

Tidak ada `Mail::fake()` — ganti dengan transport `array` sebagai gantinya
dan periksa apa yang terkumpul:

```ts
import { ArrayTransport, Mail, MailManager, setDefaultMailer } from '@elyvel/mail'

const manager = new MailManager({ default: 'array', mailers: { array: { transport: 'array' } } })
setDefaultMailer(manager)

await Mail.to('ada@example.com').subject('Hi').html('<p>Hello</p>').send()

const sent = (manager.transport('array') as ArrayTransport).sent
expect(sent).toHaveLength(1)
expect(sent[0]?.subjectLine).toBe('Hi')
```

## Notification

Mail channel milik `@elyvel/notifications` mengirimkan `Message` apa pun
yang dikembalikan `toMail(notifiable)` sebuah notifikasi. Class mailable
juga tidak wajib di sana; membuat `Message` langsung di dalam `toMail()`
adalah pola yang umum dipakai.

::: tip Queueing
Tidak ada mekanisme queued-mailable otomatis (berbeda dari queued event
listener) — untuk mengirim email di luar siklus request/response, dispatch
sebuah [queue job](/id/digging-deeper/queues) yang `handle()`-nya memanggil
`Mail.to(...).send(...)`.
:::
