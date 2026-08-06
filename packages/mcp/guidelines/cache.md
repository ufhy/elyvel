## Cache (@elyvel/cache)

- `cache()` returns the default store; `cache('redis')` a named one from
  `config/cache.ts`. Stores: memory, file, database, redis.
- Prefer `remember(key, seconds, factory)` / `rememberForever` over a manual
  get-then-put — it is one call and cannot race with itself in the same way.
- Everything is `await`, including `put`/`forget`/`flush`.
- `Lock` provides mutual exclusion for work that must not run twice
  concurrently; not every store supports it (`supportsLocks`).
- Tagged caches (`cache().tags([...])`) let you flush a group without
  flushing everything.
