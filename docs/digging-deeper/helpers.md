# Helpers & Collections

`@elyvel/support` is elyvel's zero-dependency foundation — `Str`, `Arr`,
`Collection`, `LazyCollection`, and a handful of standalone helpers, used
throughout the framework itself. It's a deliberately curated subset of
Laravel's `Illuminate\Support`, not a full 180-method clone — native array
methods already cover most of what you'd reach for.

## Strings (`Str`)

```ts
import { Str } from '@elyvel/support'
```

**Case conversion**

| Method | Example |
| --- | --- |
| `Str.studly(value)` | `Str.studly('foo_bar baz')` → `'FooBarBaz'` |
| `Str.camel(value)` | `Str.camel('foo_bar')` → `'fooBar'` |
| `Str.snake(value, delimiter?)` | `Str.snake('fooBar')` → `'foo_bar'` |
| `Str.kebab(value)` | `Str.kebab('fooBar')` → `'foo-bar'` |
| `Str.title(value)` | `Str.title('hello world')` → `'Hello World'` |
| `Str.headline(value)` | alias of `title` today |
| `Str.upper(value)` / `Str.lower(value)` | `.toUpperCase()`/`.toLowerCase()` |
| `Str.ucfirst(value)` / `Str.lcfirst(value)` | capitalize/lowercase first char only |
| `Str.slug(value, separator?)` | `Str.slug('Héllo Wörld!')` → `'hello-world'` — strips diacritics, lowercases |

::: tip No word inflection
There's no `Str.plural()`/`Str.singular()` — pluralizing English words
correctly needs a large irregular-word ruleset that's out of scope here.
Reach for a dedicated inflector library if you need it.
:::

**Truncation**

| Method | Example |
| --- | --- |
| `Str.limit(value, limit?, end?)` | `Str.limit('hello world', 5)` → `'hello...'` |
| `Str.words(value, words?, end?)` | `Str.words('a b c d', 2)` → `'a b...'` |

**Trimming & searching**

| Method | Example |
| --- | --- |
| `Str.before(value, search)` | `Str.before('a@b.com', '@')` → `'a'` |
| `Str.beforeLast(value, search)` | `Str.beforeLast('a.b.c', '.')` → `'a.b'` |
| `Str.after(value, search)` | `Str.after('a@b.com', '@')` → `'b.com'` |
| `Str.afterLast(value, search)` | `Str.afterLast('a.b.c', '.')` → `'c'` |
| `Str.between(value, from, to)` | `Str.between('[hi]', '[', ']')` → `'hi'` |
| `Str.contains(haystack, needles)` | any needle matches |
| `Str.containsAll(haystack, needles)` | every needle matches |
| `Str.startsWith(haystack, needles)` / `Str.endsWith(haystack, needles)` | needle(s) as string or array |
| `Str.is(pattern, value)` | wildcard match — `Str.is('foo.*', 'foo.bar')` → `true` |
| `Str.start(value, prefix)` | prepend unless already present — `Str.start('path', '/')` → `'/path'` |
| `Str.finish(value, cap)` | append unless already present |
| `Str.replaceFirst(search, replace, subject)` / `Str.replaceLast(search, replace, subject)` | replace only one occurrence |
| `Str.mask(value, char, index, length?)` | `Str.mask('taylor@example.com', '*', 3)` → `'tay***************'` |

**Padding, repeating, misc**

| Method | Example |
| --- | --- |
| `Str.padLeft(value, length, pad?)` / `Str.padRight(value, length, pad?)` | `Str.padLeft('7', 3, '0')` → `'007'` |
| `Str.repeat(value, times)` | `Str.repeat('ab', 3)` → `'ababab'` |
| `Str.reverse(value)` | Unicode-safe reversal |
| `Str.length(value)` / `Str.wordCount(value)` | |
| `Str.random(length?)` | CSPRNG alphanumeric string, default 16 chars |
| `Str.uuid()` | RFC-4122 v4 UUID |

Real usage: model observers commonly build a unique slug with
`Str.slug(title)`, falling back to `` `${slug}-${Str.random(6).toLowerCase()}` ``
on a collision.

## Arrays (`Arr`)

```ts
import { Arr } from '@elyvel/support'
```

Reads never mutate; `set`/`forget` mutate the target in place (matching
Laravel).

| Method | Purpose | Example |
| --- | --- | --- |
| `Arr.get(target, path, fallback?)` | dot-path read | `Arr.get(data, 'user.roles.0')` |
| `Arr.has(target, path)` | dot-path existence (counts `null` as present) | `Arr.has({ a: { b: null } }, 'a.b')` → `true` |
| `Arr.set(target, path, value)` | dot-path write, creating intermediates — **mutates** | `Arr.set({}, 'a.b.c', 1)` → `{ a: { b: { c: 1 } } }` |
| `Arr.forget(target, path)` | dot-path delete — **mutates** | |

::: warning Dot-path writes reject prototype-polluting segments
`Arr.set`/`Arr.forget` **throw** if any segment is `__proto__`, `constructor`, or
`prototype`. Assigning to `__proto__` sets an object's prototype instead of
creating a property, so walking a path through it lands on `Object.prototype` and
the next write leaks into *every* object in the process. PHP arrays have no
prototype chain, so Laravel's `Arr::set` has no equivalent hazard — the guard is
specific to the JS port.

If a path can come from a request, validate it against a known list before
calling: the throw stops the pollution but a user-triggerable 500 is still a
denial-of-service.
:::
| `Arr.only(target, keys)` / `Arr.except(target, keys)` | pick/omit keys | `Arr.only({a:1,b:2}, ['a'])` → `{a:1}` |
| `Arr.pluck(array, value, key?)` | column extraction, optionally keyed | `Arr.pluck(rows, 'name', 'id')` → `{1:'a',2:'b'}` |
| `Arr.wrap(value)` | wrap non-array in one; `null`/`undefined` → `[]` | |
| `Arr.first(array, predicate?, fallback?)` / `Arr.last(...)` | | |
| `Arr.flatten(array, depth?)` | recursive flatten | `Arr.flatten([1,[2,[3]]])` → `[1,2,3]` |
| `Arr.collapse(array)` | flatten exactly one level | `Arr.collapse([[1,2],[3]])` → `[1,2,3]` |
| `Arr.isAssoc(value)` | is a plain-object dict, not an array | |
| `Arr.random(array)` | CSPRNG-backed random element | |

`dataGet(target, path, fallback?)` (a standalone helper, not on `Arr`) is
a thin wrapper over `Arr.get` — Laravel's `data_get()` naming.

## Collections

An eager, chainable wrapper over an array — every transform returns a
**new** `Collection`, materialized immediately (unlike `LazyCollection`
below):

```ts
import { Collection } from '@elyvel/support'

const people = new Collection([
  { name: 'Ada', role: 'admin', age: 36 },
  { name: 'Alan', role: 'user', age: 41 },
  { name: 'Grace', role: 'admin', age: 45 },
])

people.filter(p => p.role === 'admin').count()   // 2
people.sortBy('age').first()?.name               // 'Ada'
people.groupBy('role').admin?.count()             // 2
people.pipe(c => c.sum('age'))
```

Full method list: `all`, `count`, `isEmpty`/`isNotEmpty`, `get`, `first`/`last`
(each with an optional predicate), `map`, `filter`, `reject`, `flatMap`,
`flatten`, `unique(by?)`, `reverse`, `sortBy`/`sortByDesc`, `take`, `skip`,
`slice`, `concat`/`merge`, `diff`, `intersect`, `implode(glue, key?)`,
`countBy(by?)`, `pipe`, `tap`, `whenEmpty`/`whenNotEmpty`, `sole` (throws
unless exactly one match), `mapWithKeys`, `reduce`, `each`, `contains`,
`pluck(key)`, `where(key, value)`/`firstWhere(key, value)`, `keyBy(key)`,
`groupBy(key)`, `sum`/`avg`/`min`/`max` (each with an optional key/selector),
`chunk(size)`, `partition(predicate)` (returns a `[matching, rest]` tuple),
`toArray`/`toJSON`. It's also directly spreadable/iterable
(`[...collection]`, `for...of`).

`toArray()`/`toJSON()` unwrap items that have their own `toObject()`
method — this is the hook that lets Eloquent models serialize themselves
correctly when a collection of them is JSON-stringified.

**Subclasses survive the chain.** Transforms that keep the element type —
`filter`, `reject`, `take`, `skip`, `slice`, `reverse`, `sortBy`,
`sortByDesc`, `unique`, `where`, `concat`/`merge`, `diff`, `intersect`,
`partition`, `groupBy`, and each `chunk` batch — return the *same* subclass
they were called on, so an `EloquentCollection` stays model-aware all the
way through `posts.filter(...).sortBy('title').take(5)`. Transforms that
**change** the element type — `map`, `flatMap`, `pluck`, `flatten` — return
a plain `Collection`, because their result no longer holds the original
element type (`posts.map(p => p.title)` is a collection of strings, not of
models). This is the same distinction Laravel draws.

::: tip Eloquent query results
`Model.query().get()` returns an `EloquentCollection`, which **extends**
this same `Collection` class — every method above already works on query
results, plus model-aware additions: `modelKeys()`, `find(id)`,
`load(...paths)` (eager-load relations onto every model already in hand),
`loadCount(...names)`. It also **overrides** `diff`/`intersect`/`unique` to
compare models by primary key (`getKey()`) instead of object reference —
so `posts.diff(await Post.whereIn('id', ids).get())` works correctly even
though the two collections hold distinct object instances for the same
rows. See [Eloquent](/database/eloquent).
:::

## Lazy Collections

Generator-based instead of array-backed — nothing is fetched or
transformed until something actually iterates, so it stays memory-bounded
over very large result sets. This is exactly what powers
`Model.query().cursor()`:

```ts
for await (const user of User.query().where('active', true).cursor(500)) {
  await sendEmail(user) // pages through the DB 500 rows at a time, never holds it all in memory
}
```

Methods: `map`, `filter`, `take(n)` (stops the source early — doesn't
drain the rest), `each(fn)`, `first()`, `toArray()` (drains everything
into a plain array — use sparingly, since it defeats the memory-bound
point). Must be consumed with `for await...of`, not `for...of` — it's
`AsyncIterable`, not `Iterable`.

## Standalone helpers

```ts
import { blank, dataGet, filled, retry, tap, value } from '@elyvel/support'

tap(new User(), u => u.save())        // side-effect, then return the value unchanged — for fluent chains
value(5)                              // 5
value(() => computeDefault())         // resolves a value that might be a thunk

blank('   ')                          // true — null/undefined, whitespace-only string, empty array/Map/Set/object
blank(0)                              // false — 0 is not blank
filled('0')                           // true — the inverse of blank; note 0/false/'0' all count as "filled"

dataGet({ a: { b: 2 } }, 'a.b')       // 2 — same as Arr.get

await retry(3, async (attempt) => {   // retry up to 3 times, with an optional delay between attempts
  return await flakyApiCall()
}, 200)

await retry(5, fetchThing, 0, error => error.message !== 'fatal') // `when` gates which errors are worth retrying at all
```

## Processes (`Process`)

Run external commands without the stream/exit-code dance `Bun.spawn` demands —
Laravel's `Process` facade:

```ts
import { Process } from '@elyvel/support'

const result = await Process.run(['git', 'status', '--porcelain'])
result.successful() // exit code 0
result.output()     // stdout; errorOutput() is stderr

await Process.path('/repo').timeout(60).env({ CI: 'true' })
  .run('bun run build')
  .then(r => r.throw()) // ProcessFailedError with the output in the message
```

A string command is split on whitespace and does **not** pass through a shell —
arguments can't be injected into one. For pipes or globs, spawn a shell
explicitly: `['sh', '-c', '…']`. `timeout(s)` SIGKILLs the child (a child that
ignores SIGTERM would hang the await forever) and rejects with
`ProcessTimedOutError`. `input(text)` feeds stdin.

## Concurrency

Run independent async tasks together — Laravel's `Concurrency::run`, minus the
process driver Laravel needs because PHP is synchronous:

```ts
import { Concurrency } from '@elyvel/support'

const [users, orders] = await Concurrency.run([
  () => db.table('users').count(),
  () => db.table('orders').count(),
])

// Named form:
const { fast, slow } = await Concurrency.run({
  fast: () => fetchSummary(),
  slow: () => fetchHistory(),
})

// Fifty tasks, six at a time, each killed after 30s:
await Concurrency.run(tasks, { limit: 6, timeoutSeconds: 30 })
```

One failure rejects the run — but only after every started task settled, so
nothing is left running behind the caller's back. Timeout timers are cleaned up
(the classic `Promise.race` leak).

## Pipeline

Pass a value through a chain of stages, each deciding whether to continue — the
onion HTTP middleware is made of, standalone:

```ts
import { Pipeline } from '@elyvel/support'

const order = await Pipeline.send(draft)
  .through([validate, reserveStock, charge])
  .then(finalize)
```

A stage is `(value, next) => …` or an object with `handle` — a class instance
works. The first stage is outermost: it sees the value first on the way in and
last on the way out, may short-circuit by not calling `next`, or try/finally
around the whole rest of the chain. `thenReturn()` ends the chain with the value
itself.
