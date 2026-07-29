# HTTP Session

Sessions persist data across requests for a single visitor — logins, flash
messages, and the CSRF token all ride on it. It's available as `ctx.session`
in any route or middleware once `config/session.ts` exists.

## Configuration

```ts
// config/session.ts
import { defineSessionConfig } from '@elyvel/core'

export default defineSessionConfig({
  driver: 'cookie',
  cookie: 'elyvel_session',
  lifetime: 60 * 120, // 2 hours
})
```

| Driver | Where data lives |
| --- | --- |
| `cookie` (default) | Encrypted in the cookie itself (AES-256-GCM) — stateless, no server-side store, no cleanup needed. |
| `memory` | In-process — resets on restart. Good for dev/test. |
| `file` | `storage/framework/sessions` (or `files` option). |
| `database` | Needs `configureDatabaseSession(adapter)` at boot (wired automatically by `EloquentServiceProvider` when a `sessions` table exists). |
| `redis` | Bun's built-in `RedisClient`. Native `EX` TTL — no GC needed. |

Every driver but `cookie`/`redis` sweeps expired entries via a GC "lottery" —
on a small percentage of requests (`lottery: [chance, outOf]`, default 2%)
rather than every one, since a full sweep touches every stored session.

::: warning The `cookie` driver can't be revoked server-side
Being stateless is the whole point of the `cookie` driver — and the cost is
that there's no server-side record to delete. `lifetime` **is** enforced on
read (it's stamped into the signed payload, not just sent as the cookie's
`Max-Age`, which a replaying attacker would simply ignore), so a captured
cookie stops working once it elapses. But within that window
`session.invalidate()` can only stop the *browser* from sending the cookie
again — it cannot retroactively invalidate a copy an attacker already has.

If you need real revocation — "log out all devices", forced re-auth after a
password change, immediate lockout — use a store-backed driver
(`file`/`database`/`redis`), where `invalidate()` deletes the record and the
old id resolves to nothing. Otherwise keep `lifetime` short.
:::

Other options: `secret` (defaults to `app.key`), `path`/`domain`/`secure`/
`httpOnly`/`sameSite` (cookie attributes), `expireOnClose` (drop `maxAge` so
the cookie dies with the browser tab).

::: details Backing classes, for custom composition
Each driver is backed by an exported `SessionStore` implementation —
`MemorySessionStore`, `FileSessionStore`, `RedisSessionStore` (plus the
internal database-backed one behind `configureDatabaseSession`). Most
apps never touch these directly — pick a `driver` string in config — but
they're there if you need to construct one yourself (e.g. wiring a custom
Redis client) or implement your own `SessionStore`. `sessionPlugin(config)`
is the Elysia plugin the framework mounts internally to wire a store into
`ctx.session`.
:::

## Reading & writing

```ts
route().get('/cart', ({ session }) => {
  const items = session.get('cart', [])
  return { items }
})

route().post('/cart', ({ session, body }) => {
  session.put('cart', body.items)
})
```

Full API: `get(key, fallback?)`, `put(key, value)`, `has(key)` (present and
not null), `exists(key)` (present, even if null), `missing(key)`,
`forget(key)`, `pull(key, fallback?)` (get + forget in one step), `push(key,
value)` (append to an array value), `increment`/`decrement`, `remember(key,
factory)`, `all()`.

## Flash data

Flash a value that survives exactly one more request — the classic
"redirect back with a success message" pattern:

```ts
route().post('/posts', ({ session, body }) => {
  const post = Post.create(body)
  session.flash('success', 'Post created.')
  return back()
})
```

`reflash()` keeps every currently-flashed key for one more request;
`keep(['success'])` keeps specific keys instead of all of them.

## Regenerating the session

Rotate the session id (and CSRF token) right after a privilege change —
Laravel's anti session-fixation guidance applies the same way here:

```ts
route().post('/login', async ({ session, request }) => {
  // ... verify credentials ...
  session.regenerate() // new id + new CSRF token, data kept
})
```

`invalidate()` does the same rotation but also clears all session data
(`logout`, typically). Both only matter for store-backed drivers
(`memory`/`file`/`database`/`redis`) — the `cookie` driver has no separate
server-side id to fixate.

Calling `regenerate()` at login is still the right habit, but a session id
the server never issued is no longer usable on its own: an incoming id is
only adopted when it both looks like one we generated and resolves to a
session the store actually holds. Anything else (a planted value, a forged
one, an id whose session expired or was invalidated) gets a fresh id
instead — so an attacker can't pick the id a victim's session will live
under, and a destroyed session can't be revived by replaying its old id.

## CSRF protection

Every session ships a CSRF token (`session.token()`), readable client-side
via the `XSRF-TOKEN` cookie (for SPA double-submit, à la Axios). Apply the
built-in `csrf` alias to state-changing routes — or pull in the whole `web`
group, which bundles it:

```ts
route().use(group('web')).post('/profile', updateProfile) // csrf-protected
```

A request's token comes from the `_token` body field or the
`X-CSRF-Token`/`X-XSRF-Token` header; a mismatch responds `419`. Comparison
is constant-time (`timingSafeEqual`) to avoid a timing side-channel. See
[Middleware](/basics/middleware) for the full alias/group reference.
