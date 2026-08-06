# HTTP Tests

Drive your app through `app.handle()` — no real socket or port — with a
cookie/CSRF-aware test client, fluent response assertions, and a
per-test-isolated database. All three pieces are independent and usable on
their own.

## Making requests

```ts
import { createApp } from '@elyvel/core'
import { createTestClient } from '@elyvel/testing'

const app = createApp({ basePath: import.meta.dir })
const client = createTestClient(app)

const res = await client.post('/users', { json: { name: 'Grace' } })
res.assertCreated().assertJson({ data: { name: 'Grace' } })
```

`get`/`post`/`put`/`patch`/`delete`/`head(path, options?)` all accept
`{ json, headers, query, body }` — `json` is auto-serialized with
`content-type: application/json`; `body` is a raw alternative for
non-JSON payloads. `withHeaders(...)`/`withToken(token)`/`withCookie(name,
value)` set defaults that carry across every subsequent request from the
same client.

## Asserting on the response

`TestResponse` is a small, chainable assertion object — not an extension
of `bun:test`'s `expect()` — that throws with the status and body included
in the error message on failure:

```ts
const res = await client.get('/posts/1')

res.assertOk()
res.assertJson({ title: 'Hello' })          // deep partial match
res.assertJsonPath('author.name', 'Ada')    // dot-path lookup
res.assertHeader('content-type', 'application/json; charset=utf-8')
res.assertSee('Hello')                       // substring check on the raw body
```

::: tip What the JSON assertions do and don't match
`assertJson` is a **deep partial** match: extra keys in the response are fine,
and an expected array matches a prefix of the actual one. Two things it is strict
about:

- **An empty expected array or object asserts emptiness**, not "anything goes".
  `assertJson({ errors: [] })` fails when `errors` has entries — which is what you
  want, since that assertion is usually written to prove there were none. (A
  vacuous `every` over an empty list used to make it pass in exactly that case.)
- **Types are not coerced.** `{ count: '2' }` does not match `{ count: 2 }`.

`assertJsonPath` compares **structurally**, so key order in an expected object
doesn't matter, but array order does. Passing `undefined` as the expected value
asserts the path is *absent* — handy, but note a typo'd path also satisfies it.

`assertSee` is a substring check on the **raw** body, with no HTML unescaping: to
match text the renderer escaped, write the escaped form (`'Ada &amp; Bob'`) or
compare against `.text()` yourself.
:::

Also available: `assertStatus(code)`, `assertCreated()`, `assertNoContent()`,
`assertNotFound()`, `assertUnauthorized()`, `assertForbidden()`,
`assertSuccessful()` (any 2xx), `assertRedirect(location?)`. Drop to
`.json<T>()`/`.text()`/`.status`/`.headers` directly when a built-in
assertion isn't specific enough — they compose fine with plain `expect()`.

## Cookies & CSRF — handled automatically

The client carries its own cookie jar: every `Set-Cookie` the app returns
is captured and replayed on later requests from that same client, so a
session established at one route is still there on the next request. A
`Set-Cookie` that *deletes* a cookie (`Max-Age=0`, or a past `Expires`) removes it
from the jar, the same as a browser would — so after hitting a logout route the
client stops sending it instead of replaying an empty value. For
any non-GET/HEAD/OPTIONS request, it also mirrors the `XSRF-TOKEN` cookie
into an `X-XSRF-Token` header automatically — the same double-submit
pattern a real browser/axios does — so a CSRF-protected `POST` just works
as long as a prior request in the same test established the session:

```ts
await client.get('/posts/1') // establishes session + XSRF cookies
await client.post('/posts/1/comments', { json: { body: 'Nice post' } }) // CSRF header auto-attached
```

Skipping that first request and posting cold correctly fails with a CSRF
mismatch — the client doesn't paper over a missing session.

## Acting as a user

There's no `/login`-and-capture-cookies helper — sessions are Better
Auth-backed, so tests bypass the login flow entirely via a dedicated test
seam:

```ts
import { stopActingAs } from '@elyvel/auth'

await client.actingAs(author)
const res = await client.post('/posts', { json: { title: 'New post' } })
res.assertStatus(303)

stopActingAs() // required — this override is process-global, not per-client
```

`client.actingAs(user)` is a convenience wrapper around `@elyvel/auth`'s
`actingAs()`. Because the override is process-global rather than scoped to
one client, always pair it with `stopActingAs()` (typically in
`afterEach`) so a later test — or a second client in the same test — isn't
left authenticated as the wrong user. `actingAsGuest()` forces
unauthenticated instead.

`currentTestActor()` reads back whoever the override currently resolves
to (`User | null | undefined`) — useful inside a shared test helper that
needs to know whether `actingAs`/`actingAsGuest` is currently active
without threading the user through as a parameter.

## Database isolation

```ts
import { migrate } from '@elyvel/database'
import { refreshDatabase } from '@elyvel/testing'
import { join } from 'node:path'

beforeEach(async () => {
  await refreshDatabase({
    seed: async (connection) => {
      await migrate(connection, join(import.meta.dir, '../database/migrations'))
    },
  })
})
```

`refreshDatabase(options?)` opens a brand-new connection (in-memory SQLite
by default) and makes it the active one, so every test starts from a
genuinely empty database — no leftover rows from a previous test to clean
up. Pass a different `connection` config to test against Postgres/MySQL
instead; `seed` is where you run migrations (and any fixture data) against
the fresh connection.

## Faking mail, queues, notifications, events

Each subsystem has a recording fake with assertions — Laravel's `Mail::fake()`
family. A fake replaces the default manager, so every path in is captured, and
**nothing runs**: no SMTP, no job `handle()`, no Telegram HTTP call.

```ts
import { fakeMail } from '@elyvel/mail'
import { fakeQueue } from '@elyvel/queue'
import { fakeNotifications } from '@elyvel/notifications'
import { fakeEvents } from '@elyvel/events'

test('placing an order notifies and queues', async () => {
  const mail = fakeMail()
  const queue = fakeQueue()
  const notifications = fakeNotifications()

  await client.post('/orders', { body: cart })

  mail.assertSent(OrderReceipt, m => m.toAddresses.some(a => a.email === 'ada@example.com'))
  queue.assertPushed(SyncInventory, job => job.orderId === 42)
  queue.assertPushedOn('emails', SendFollowUp)
  notifications.assertSentTo(user, OrderShipped)
})
```

The assertions and what they check:

| | |
|---|---|
| `assertSent` / `assertPushed` / `assertSentTo` | at least one match — by class, by predicate, or both |
| `assertNotSent` / `assertNotPushed` / `assertNotSentTo` | zero matches |
| `assertNothingSent` / `assertNothingPushed` | the fake saw nothing at all |
| `…Times(x, n)` / `assertCount(n)` | exact counts |
| `assertPushedOn(queue, Job)` | the named queue lane |
| `assertClosurePushed()` | a closure job — they have no class to name |

A failed assertion names what **did** happen (`Dispatched: GenerateReport`), so
the diagnosis is in the failure instead of a debugger session. Matching a
notifiable works across instances: the user your test created matches the one
the handler re-fetched, by model key.

Restore the real manager with `restoreMail(new MailManager())` (and the queue /
notification equivalents) in `afterEach` — the defaults are process-wide, like
every default manager here. The lower-level pieces (`ArrayTransport`,
`MemoryQueueStore`, `ArrayChannel`, `ArrayBroadcaster`) still exist for tests
that want the real pipeline to run.

## Testing console commands

Run a command in-process and assert on its output and exit code — Laravel's
`$this->artisan(...)`:

```ts
import { runCommand } from '@elyvel/testing'
import { elyvelCommands } from '../app/commands'

const result = await runCommand(myCommand, 'route:list --json')
result.assertSuccessful().expectsOutput('/users/:id')

const failed = await runCommand(myCommand, '')
failed.assertFailed().expectsOutput('Who am I greeting?')
```

A string argv is parsed exactly as the CLI parses `process.argv`, so
`'ada --shout'` behaves like typing it after `elyvel greet`. In-process matters:
fixtures the test set up — a fake queue, an in-memory SQLite — are visible to the
command, which a spawned child process would never see. A command that throws
comes back as exit 1 with the error text as output; ANSI colors are stripped
before matching, so you assert on what a human reads.

## Full example

Putting the pieces together — a real app, an isolated database, an
authenticated request, and a business-logic assertion made directly
against the model rather than only the HTTP response:

```ts
import { createApp } from '@elyvel/core'
import { migrate } from '@elyvel/database'
import { actingAs, stopActingAs } from '@elyvel/auth'
import { createTestClient, refreshDatabase } from '@elyvel/testing'

describe('creating a post', () => {
  let client: ReturnType<typeof createTestClient>

  beforeEach(async () => {
    await refreshDatabase({ seed: conn => migrate(conn, migrationsDir) })
    const app = createApp({ basePath: appDir })
    client = createTestClient(app)
  })

  afterEach(() => stopActingAs())

  it('slugifies the title and persists it', async () => {
    await client.actingAs(author)
    const res = await client.post('/posts', { json: { title: 'Hello World' } })

    res.assertStatus(303)
    const post = await Post.query().where('title', 'Hello World').first()
    expect(post?.slug).toBe('hello-world')
  })
})
```
