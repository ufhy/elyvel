# Cache

A store-agnostic cache API — Laravel's `Cache` facade. Swap `memory` for
`file`/`database`/`redis` in config without touching a single call site.

## Configuration

```ts
// config/cache.ts
import { defineCacheConfig } from '@elyvel/cache'

export default defineCacheConfig({
  default: process.env.CACHE_STORE ?? 'memory',
  stores: {
    memory: { driver: 'memory' },
    file: { driver: 'file', path: 'storage/framework/cache' },
    database: { driver: 'database' }, // needs a `cache` table (EloquentServiceProvider wires it)
    redis: { driver: 'redis', url: process.env.REDIS_URL, prefix: 'cache:' },
  },
})
```

`memory` needs no config entry — it's always available and used as the
fallback if `default` isn't set.

## Storing & retrieving

```ts
import { cache } from '@elyvel/cache'

await cache().put('key', value, 60)     // seconds; omit for "forever"
await cache().forever('key', value)
const value = await cache().get('key', 'default')

await cache().has('key')
await cache().missing('key')
await cache().add('key', value, 60)     // only stores if the key is absent — returns whether it did
await cache().pull('key')               // get + forget in one step
await cache().forget('key')
await cache().flush()                   // wipe the whole store

await cache().increment('hits')
await cache().decrement('hits')

cache('redis') // a specific named store instead of the default
```

## `remember`

The common "get from cache, or compute and store" pattern:

```ts
const users = await cache().remember('users.active', 300, () => User.where('active', true).get())

await cache().rememberForever('site.settings', () => Settings.first())
```

Concurrent callers racing the same cold/expired key are coalesced within one
process — only the first caller actually runs the factory; the rest await its
result, instead of every one of them hitting the origin (thundering herd on a
popular key's expiry). Tagged views (`cache().tags(...).remember(...)`) get
the same coalescing.

::: tip `add` and `pull` are atomic — with one caveat
`add()` is the once-only guard (send-this-email-once,
dispatch-this-job-once) and `pull()` reads a single-use value, so both go
through a single indivisible store operation rather than a
read-then-write pair: exactly one concurrent caller gets `true` from
`add()`, and exactly one receives the value from `pull()`.

The caveat is *scope*. `redis` is atomic across processes (`SET NX` /
`GETDEL`). `memory` and `file` are atomic within one process — enough for a
single instance, but two instances pointing at the same cache directory can
still both win, the same limitation the file driver's `increment` has.
`database` needs an adapter that implements `add` (one
`INSERT … ON CONFLICT DO NOTHING`); without it, it degrades to the
read-then-write pair. Where the guarantee genuinely has to hold across
instances, use `redis`, a database unique constraint, or the queue's own
unique-job support.

`increment()` doesn't create or refresh a window: a live key keeps whatever
expiry it already had, and incrementing one whose TTL has elapsed starts a
fresh counter with **no** expiry (matching Redis `INCRBY`). So a counter you
want to reset periodically needs its window re-established — `put()` the key
with a TTL, or use [Rate Limiting](/digging-deeper/rate-limiting), which
manages it for you. If you write your own `database` adapter, note that its
optional atomic `increment` must treat an expired row as absent; see the
`CacheDbAdapter` docstring for a single statement that does it.
:::

## Tags

Group related entries so they can be invalidated together, without touching
the rest of the cache (Laravel's `Cache::tags(...)`):

```ts
await cache().tags(['posts', `post:${post.id}`]).put('rendered', html, 3600)

// Later, when a post changes:
await cache().tags([`post:${post.id}`]).flush() // only entries under this tag
```

Tags work identically on every store (memory/file/database/redis) — each tag
has a version id, and flushing just rotates it, so previously-tagged entries
become unreachable and expire on their own TTL rather than being enumerated
and deleted.

## Which store to pick

| Driver | Notes |
| --- | --- |
| `memory` | Per-process, resets on restart/redeploy. Fine for dev, tests, or a single-instance app. |
| `file` | Survives restarts; not shared across multiple app instances. |
| `database` | Shared across instances; adds one query per operation. |
| `redis` | Shared, fast, and the only driver with native TTL (no key ever needs sweeping). |
