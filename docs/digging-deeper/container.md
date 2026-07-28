# Service Container

Every binding is keyed by a typed **token**, not a string — resolving a
token returns the exact type it was declared with, no casts, no facades,
no `any` leaking into userland. This is deliberately narrower than
Laravel's container: there's no auto-resolution/reflection-based
injection, no contextual binding, no tagging, and no aliases — elyvel's
"no runtime magic" philosophy means every binding is explicit code you can
jump to, not something inferred from constructor parameter types.

## Tokens

```ts
import { token } from '@elyvel/core'

interface Mailer { send(to: string, body: string): Promise<void> }
const MailerToken = token<Mailer>('mailer')
```

A token is just `{ key: string }` with a phantom type — `key` is what the
container actually stores bindings under; the type parameter only exists
at compile time, to make `make()` return the right type.

## Binding, from a service provider

Every app has a `container` (`Application.container`), reached from a
`ServiceProvider`'s `this.app.container`. `register()` is where bindings
go — `boot()` runs after every provider's `register()`, so it's safe to
resolve services there, but not inside another provider's own `register()`:

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
    const mailer = this.app.make(MailerToken) // safe here — every register() has already run
    await mailer.send('ops@example.com', 'App booted')
  }
}
```

`app.make(token)` (used above) is shorthand for `app.container.make(token)`.

## Binding methods

```ts
container.bind(Token, app => new Thing())        // a fresh value on every make()
container.singleton(Token, app => new Thing())    // resolved once, then cached
container.instance(Token, alreadyBuiltThing)      // register a value you already have

container.bindIf(Token, factory)                  // only if not already bound
container.singletonIf(Token, factory)

container.has(Token)                              // bound (factory or instance)?
container.bound(Token)                             // alias of has()

container.forget(Token)                            // remove one binding + its cached instance
container.flush()                                   // remove everything (mainly for tests)
```

The factory receives the container itself, so a binding can depend on
another:

```ts
container.singleton(MailerToken, app => new SmtpMailer(app.make(ConfigToken)))
```

## Resolving

```ts
const mailer = container.make(MailerToken) // typed as Mailer, no cast
```

Throws if the token was never bound — the error names the token so you
know which provider is missing.

## Decorating a bound service

`extend()` wraps an already-bound value after it's resolved — for
decorating a service without re-registering its whole binding (e.g.
wrapping a logger to add metrics, wrapping a mailer to add a dry-run mode
in tests):

```ts
container.extend(MailerToken, (mailer, app) => {
  return app.config.get('app.env') === 'testing' ? new DryRunMailer(mailer) : mailer
})
```

For a `singleton`/`instance` binding, the decorator runs once — immediately
if the value was already resolved, otherwise the next time it's built — and
the wrapped value is what gets cached. For a plain `bind`, it runs fresh on
every `make()`, since a fresh value is produced every time anyway. Multiple
`extend()` calls on the same token apply in registration order.

## Testing

`container.flush()` between tests clears every binding and cached
instance, so a fresh `Container` (or a fresh app boot) starts clean —
useful when a test needs to re-register a fake in place of a real
binding (`container.instance(MailerToken, fakeMailer)`).
