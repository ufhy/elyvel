# Writing a Driver

Every subsystem that picks an implementation by name — mail transports, queue
backends, cache stores, disks, session stores, log channels, broadcasters,
database drivers, notification channels — takes drivers the framework has never
heard of. You publish a package; nobody edits elyvel.

This mirrors Laravel's `Manager::extend()`, and for the same reason: the
interfaces (`Transport`, `CacheStore`, `SessionStore`, `QueueStore`, …) were
always public, so anyone could *write* a driver. Registering one is what needs a
door.

## Managers: `extend()`

Mail, cache, queue and storage resolve through a manager instance. Register from
a service provider's `boot()` — drivers are built lazily, so anything registered
before first use takes effect, and a registered name overrides a built-in one.

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

The factory receives the config block and the name it was resolved under. The
same shape applies to `CacheManager.extend`, `QueueManager.extend` and
`FilesystemManager.extend`.

## Registered before boot: session, logging, broadcasting, database

These are built while the framework boots, before an app can reach an instance,
so they register through module functions instead:

```ts
import { registerLogDriver, registerSessionDriver } from '@elyvel/core'
import { registerDatabaseDriver, registerGrammar } from '@elyvel/database'
import { registerBroadcastDriver } from '@elyvel/broadcasting'

registerSessionDriver('dynamodb', config => new DynamoSessionStore(config))
registerLogDriver('http', ({ config }) => [new HttpTransport(config.url)])
registerBroadcastDriver('pusher', async ({ app, config }) => new PusherBroadcaster(config))
registerDatabaseDriver('oracle', config => new OracleConnection(config))
```

Call these at import time in your package's entry, or from a provider's
`register()`. A database driver also needs a grammar for its dialect —
`registerGrammar('oracle', () => new OracleGrammar())`.

## Notification channels: no registration at all

A channel is identified by its class, so a package exports one and an app names
it in `via()`. Nothing to register, nothing to configure:

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
    return { text: 'Your order is on its way' }
  }
}
```

One instance per class is created and reused, so a channel holding an HTTP client
or a socket is built once. Strings and classes mix freely in one `via()`.

## Typing the config

Config unions stay closed for built-ins — so `transport: 'smpt'` is still a typo
the compiler catches, and SMTP options still autocomplete — with room for a
registered name:

```ts
driver: 'memory' | 'file' | 'database' | 'redis' | (string & {})
```

Your driver's own options come through as part of the config object; cast it to
your own interface inside the factory, where you know what it should be.

## When a name isn't found

The error names every driver that IS registered:

```
[elyvel] Mail transport "resnd" is not supported. Available: array, log, resend, smtp.
Register it with `MailManager.extend(name, factory)` from a provider.
```

That is deliberate: a missing driver is nearly always a typo or a package the app
forgot to install, and neither is visible from "unsupported driver" alone.
