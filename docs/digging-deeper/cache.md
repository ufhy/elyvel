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
popular key's expiry).

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
