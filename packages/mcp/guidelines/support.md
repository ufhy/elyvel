## Helpers (@elyvel/support)

Reach for these before writing a utility:

- `Str` (slug, camel, snake, kebab, studly, title, headline, limit, words,
  before/after/between, mask, random, …) and `Arr` (has, set, forget, only,
  except, pluck, first, last, flatten, collapse, wrap). Two gaps worth
  knowing: there is no `Str.uuid` (use `crypto.randomUUID()`) and no
  `Arr.get` — reading a dot-path is `dataGet(target, 'a.b.c')`.
- `Collection` / `LazyCollection` for chained map/filter/groupBy/sum work —
  Eloquent queries already return collections.
- `Pipeline` for send/through/then composition.
- `Process` to run a command (`Process.run('git status')`) — never
  `child_process` directly; it never goes through a shell.
- `Concurrency.run` / `runConcurrently` for bounded parallel work with
  per-task timeouts, instead of a bare `Promise.all` over hundreds of items.
- `dataGet`, `blank`, `filled`, `tap`, `value`, `retry` are the small Laravel
  helpers, same semantics.
