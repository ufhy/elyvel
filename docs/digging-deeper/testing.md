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

Also available: `assertStatus(code)`, `assertCreated()`, `assertNoContent()`,
`assertNotFound()`, `assertUnauthorized()`, `assertForbidden()`,
`assertSuccessful()` (any 2xx), `assertRedirect(location?)`. Drop to
`.json<T>()`/`.text()`/`.status`/`.headers` directly when a built-in
assertion isn't specific enough — they compose fine with plain `expect()`.

## Cookies & CSRF — handled automatically

The client carries its own cookie jar: every `Set-Cookie` the app returns
is captured and replayed on later requests from that same client, so a
session established at one route is still there on the next request. For
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

## Faking mail, events, notifications, broadcasts

There's no unified "fakes" facade here — each subsystem's fake is
independent and documented on its own page: Mail's `ArrayTransport` (see
[Mail](/digging-deeper/mail#testing)), Events' `fakeEvents()` (see
[Events](/digging-deeper/events#testing)), Notifications' `ArrayChannel`
(see [Notifications](/digging-deeper/notifications#testing)),
Broadcasting's `ArrayBroadcaster` (see
[Broadcasting](/digging-deeper/broadcasting#testing)). Mix and match
whichever ones a given test needs alongside `createTestClient`.

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
