# Mail

A fluent, transport-agnostic API for sending email. Point it at SMTP in
production and `log` in development, without changing a single call site.

## Configuration

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
    log: { transport: 'log' },   // writes to the logger — the dev default
    smtp: {
      transport: 'smtp',
      host: process.env.MAIL_HOST ?? 'localhost',
      port: Number(process.env.MAIL_PORT ?? 1025),
      secure: false,
    },
  },
})
```

Three transports ship out of the box: `log` (dev default, writes to the
logger instead of sending anything), `array` (collects sent messages
in-memory — see [Testing](#testing) below), and `smtp` (real delivery via
`nodemailer`, an optional peer dependency). `from` is the fallback sender
applied whenever a message doesn't set its own.

## Sending mail

The quickest path — no `Mailable` class needed:

```ts
import { Mail } from '@elyvel/mail'

await Mail.to('ada@example.com')
  .subject('Welcome')
  .html('<h1>Hi Ada</h1>')
  .send()

// cc / bcc / a specific sender, all chainable
await Mail.to('ada@example.com')
  .cc({ email: 'team@example.com', name: 'Team' })
  .bcc('audit@example.com')
  .from({ email: 'hello@example.com', name: 'App' })
  .subject('Welcome')
  .html('<h1>Hi Ada</h1>')
  .send()

// a mailer other than the default
await Mail.mailer('smtp').to('ada@example.com').subject('Hi').text('Hello').send()
```

## Mailable classes

For anything reused or with real logic behind it, extend `Mailable` and set
everything on the `Message` it's handed:

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

There's a single `build()` method — no separate envelope/content split.
Recipients can be set either on `Mail.to(...)` at the call site, or inside
`build()` via `message.to(...)`, whichever reads better for the mailable.

## Views for the HTML body

`.html(...)` accepts a plain string, or anything with a `render()` method —
a compiled `@elyvel/view` template renders straight into the body:

```ts
message.html(view('emails/welcome', { name: this.name }))
```

Since mail is sent outside an HTTP request, the shared template data a view
would normally get from the request (session, CSRF token, flash) isn't
available — those come through as empty defaults instead.

## Attachments

```ts
message.attach({
  filename: 'invoice.pdf',
  content: pdfBytes,             // string or Uint8Array
  contentType: 'application/pdf',
})
```

There's no `@elyvel/storage` shortcut or inline/embedded-image API yet —
read the file's bytes yourself and attach them directly.

## Failed sends

A send that throws is recorded (mailer name, a `{ to, cc, bcc, subject }`
summary, and the error) before the error is rethrown — opt in with
`configureFailedMail(adapter)` at boot; a `MemoryFailedMailStore` ships by
default. This mirrors `@elyvel/queue`'s failed-job store, so failures aren't
silently lost even without a full mail-monitoring setup.

Read them back with `failedMail()`:

```ts
import { failedMail } from '@elyvel/mail'

const records = await failedMail()?.all()
await failedMail()?.find(id)
await failedMail()?.forget(id)   // delete one
await failedMail()?.flush()      // delete all
await failedMail()?.prune(24)    // delete records older than 24 hours
```

## Testing

There's no `Mail::fake()` — swap in the `array` transport instead and
inspect what it collected:

```ts
import { ArrayTransport, Mail, MailManager, setDefaultMailer } from '@elyvel/mail'

const manager = new MailManager({ default: 'array', mailers: { array: { transport: 'array' } } })
setDefaultMailer(manager)

await Mail.to('ada@example.com').subject('Hi').html('<p>Hello</p>').send()

const sent = (manager.transport('array') as ArrayTransport).sent
expect(sent).toHaveLength(1)
expect(sent[0]?.subjectLine).toBe('Hi')
```

## Notifications

`@elyvel/notifications`' mail channel delivers whatever `Message` a
notification's `toMail(notifiable)` returns. A mailable class isn't required
there either; constructing a `Message` directly inside `toMail()` is the
common pattern.

::: tip Queueing
There's no automatic queued-mailable mechanism (unlike queued event
listeners) — to send mail off the request/response cycle, dispatch a
[queue job](/digging-deeper/queues) whose `handle()` calls `Mail.to(...).send(...)`.
:::
