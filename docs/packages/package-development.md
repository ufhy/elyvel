# Package Development

How to build something others install next to elyvel — a driver, a notification
channel, a set of commands. The through-line: **the framework never needs to
know your package exists.** Every extension point below is one built-ins use
too.

## A service provider, auto-discovered

Export `elyvelProviders` from your package's main entry and
`elyvel package:discover` (run automatically on install via `postinstall`)
registers it into `bootstrap/providers.generated.ts`:

```ts
// src/index.ts
export class AcmeServiceProvider extends ServiceProvider {
  override register(): void { /* bind things into the container */ }
  override boot(): void { /* runs after every provider registered */ }
}

export const elyvelProviders = [AcmeServiceProvider]
```

An app can exclude a package from discovery with `dontDiscover` in
`config/app.ts`, and register the provider itself.

## CLI commands

Export `elyvelCommands` from a **separate `/cli` subpath** — never the main
entry, so importing your package at runtime doesn't pull command code (and its
`node:fs` imports) into the app process:

```ts
// src/cli.ts, exposed as "@acme/thing/cli" in package.json `exports`
export const elyvelCommands: ConsoleCommand[] = [{
  name: 'acme:sync',
  description: 'Sync the things',
  async run(flags, args) { /* … */ return 0 },
}]
```

Discovery writes them into `bootstrap/commands.generated.ts`; test them
in-process with [`runCommand`](/digging-deeper/testing#testing-console-commands).

## Drivers

Every subsystem that picks an implementation by name accepts registered ones —
mail transports, queue backends, cache stores, disks, session stores, log
channels, broadcasters, database drivers. See
[Writing a Driver](/packages/writing-drivers) for the full contract; the short
form:

```ts
export class AcmeServiceProvider extends ServiceProvider {
  override boot(): void {
    this.app.make(MailToken).extend('acme', cfg => new AcmeTransport(cfg))
  }
}
```

## Notification channels

No registration at all — the class is the identifier. Export it; apps name it in
`via()`:

```ts
export class WhatsAppChannel {
  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    const message = notification.toWhatsApp?.(notifiable)
    // …
  }
}
```

## Validation rules

```ts
import { registerRule } from '@elyvel/validation'

registerRule('phone', (value, [country = 'ID']) => isPhone(String(value), country),
  'The :attribute must be a valid phone number.')
```

The message is a fallback — an app's `validation::phone` translation overrides
it, so your rule is localisable without your involvement.

## Config and translations

Ship defaults inside your package and read them via `config('acme.…')`; apps
override by creating `config/acme.ts`. Translations under your package's `lang/`
load into a namespace (`acme::key`) and can be overridden from
`lang/vendor/acme/`.

## Publishing

- Ship TypeScript source (`files: ["src"]` plus any runtime asset directories —
  `templates/`, `stubs/`, `lang/`; forgetting one is invisible until an install
  fails).
- Peer-depend on the `@elyvel/*` packages you import; never bundle them.
- One exception to source-shipping: code a **Node** process must load (a Vite
  plugin, for instance) must be plain `.mjs` — Vite loads `vite.config.ts` under
  Node, which cannot import raw TypeScript.
