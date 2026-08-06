# Eloquent: Getting Started

Eloquent is elyvel's Active Record ORM: each model maps to a table, and an
instance maps to a row. It runs unchanged on SQLite, Postgres, or MySQL —
switching databases is a config change, not a rewrite.

## Configuration

Connections live in `config/database.ts`; swapping the active one is just
changing `default`:

```ts
// config/database.ts
import { defineDatabaseConfig } from '@elyvel/database'

export default defineDatabaseConfig({
  default: process.env.DB_CONNECTION ?? 'sqlite',
  connections: {
    sqlite: { driver: 'sqlite', database: 'database/database.sqlite' },
    pglite: { driver: 'pglite', dataDir: 'database/pglite' }, // embedded PG, no server
    pg: { driver: 'pg', url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/app' },
  },
})
```

Drivers: `bun:sqlite` (built in), `@electric-sql/pglite` (embedded Postgres,
WASM), `postgres` (real Postgres server, optional peer dependency), and
`mysql` (MySQL/MariaDB via `kysely` + `mysql2`, both optional peer
dependencies).

Outside a framework app, connect directly without a service provider:

```ts
import { createConnection, setConnection } from '@elyvel/database'

const conn = await createConnection({ driver: 'sqlite', database: ':memory:' })
setConnection(conn) // becomes the default connection used by models
```

## Defining models

```ts
import { Model } from '@elyvel/database'

export class User extends Model {
  static override table = 'users'
  static override hidden = ['password']         // never serialized
  static override casts = { id: 'int', phone: 'encrypted' } as const

  declare id: number
  declare name: string
  declare email: string
  declare password: string
  declare phone: string | null

  // relationships are plain methods
  posts() {
    return this.hasMany(Post)
  }
}
```

Overridable statics: `table`, `primaryKey`, `timestamps`, `connection`,
`hidden`, `visible`, `appends`, `casts`, `accessors`, `scopes`, `fillable`,
`guarded`, `softDeletes`, `deletedAtColumn`, `usesUniqueIds`, `userstamps`,
`createdByColumn`, `updatedByColumn`, `deletedByColumn`.

Conveniences: `Model.findMany(ids)`, `Model.whereKey(id)`,
`Model.withoutTimestamps(fn)`, `query.sole()`, `instance.replicate()`,
`instance.touch()`. Set `static usesUniqueIds = true` to auto-generate a UUID
primary key on create (override `static newUniqueId()` for ULIDs).

### Model concerns (trait equivalent)

Bundle a reusable `fillable`/`casts`/scope set — e.g. "every model with a
status column" — instead of repeating the same statics on every model that
needs it (Laravel's traits). `elyvel make:concern HasStatus` scaffolds one:

```ts
// app/concerns/HasStatus.ts
import type { Concern } from '@elyvel/database'

export interface HasStatusFields {
  status: string
}

export const HasStatus: Concern = {
  fillable: ['status'],
  casts: { status: 'string' },
  scopes: { active: q => q.where('status', 'active') },
  globalScopes: { published: q => q.where('published', true) },
  methods: {
    isActive(this: Model & HasStatusFields) { return this.status === 'active' },
  },
}
```

Apply it right after the model's class declaration with `withConcerns` —
merge the typed fields onto the model with a same-named `interface`
declaration (TypeScript combines the two):

```ts
import { Model, withConcerns } from '@elyvel/database'
import { HasStatus, type HasStatusFields } from '../concerns/HasStatus'

// eslint-disable-next-line ts/no-unsafe-declaration-merging -- fields only
export interface Post extends HasStatusFields {}
// eslint-disable-next-line ts/no-unsafe-declaration-merging
export class Post extends Model {
  static override table = 'posts'
}
withConcerns(Post, HasStatus)

await Post.query().scope('active').get()   // local scope from the concern
new Post().isActive()                       // method from the concern
```

The two `eslint-disable` lines are needed because the lint preset flags every
class/interface merge. Here the interface only *adds* column types and never
conflicts with `Model`'s own members, which is exactly the safe case the rule
can't distinguish.

`fillable`/`casts` from every applied concern merge into the model's own;
`scopes` are opt-in (call `.scope('name')`), `globalScopes` auto-apply to
every query on the model (note: global scopes see the raw `QueryBuilder`,
not the Eloquent-aware builder local scopes get); `methods` are merged onto
the model's prototype.

## CRUD

```ts
const user = await User.create({ name: 'Ada', email: 'ada@example.com' })

user.name = 'Ada Lovelace'
await user.save()

await user.update({ email: 'ada@lovelace.dev' })
await user.delete()

const found = await User.find(1)
const orFail = await User.findOrFail(1)
const ada = await User.where('email', 'ada@example.com').first()
const all = await User.all()

await User.firstOrCreate({ email: 'a@b.c' }, { name: 'A' })
await User.updateOrCreate({ email: 'a@b.c' }, { name: 'A2' })
```

## Query builder

Use it through a model (`User.query()`) or standalone without a model, à la
Laravel's `DB::table()` — the standalone form returns raw rows and can target
any named connection:

```ts
import { table } from '@elyvel/database'

const rows = await table('users').where('active', true).orderByDesc('id').get()
await table('logs', 'analytics').count() // second arg = named connection

// pagination on the raw builder too
const page = await table('users').orderBy('id').paginate(15, 1)
await table('users').cursorPaginate(15, cursor)

// lazy / keyset iteration
for await (const row of table('users').cursor()) { /* ... */ }
await table('users').chunkById(1000, (rows) => { /* ... */ })
```

Most of the method set is shared between `table()` and `Model.query()` —
`whereNot`, `orWhereNull`, `rightJoin`/`crossJoin`/join closures,
`inRandomOrder`, `reorder`, `groupByRaw`, `havingBetween`, `unionAll`,
`skip`/`take`, `addSelect`, `truncate`, `incrementEach`, `doesntExist`,
`find`. A few are `table()`-only (raw `QueryBuilder`), not yet on
`Model.query()`'s Eloquent-aware builder: `whereLike`,
`whereDate`/`whereYear`/`whereMonth`/`whereDay`/`whereTime`,
`whereBetweenColumns`, `whereJsonContains`, `whereFullText`, `chunkById`.

```ts
// Full-text match — MySQL MATCH/AGAINST, Postgres tsvector/tsquery, SQLite
// falls back to a LIKE approximation (see the "Migrations" full-text index).
await table('posts').whereFullText('body', 'elephants').get()
await table('posts').whereFullText(['title', 'body'], 'bananas', { mode: 'boolean' }).get()

// `lazyById` — an explicit alias of `cursor()`/`lazy()`, which already page
// by keyset (not OFFSET), so there's no separate implementation to reach for.
for await (const row of table('users').lazyById()) { /* ... */ }
```

**Subqueries** are supported throughout — select, from, join, and where:

```ts
const teamB = table('teams').select('id').where('title', 'B')
await table('users').whereIn('team_id', teamB).get()          // where … in (subquery)

await table('users')
  .selectSub(table('orders').selectRaw('count(*)'), 'orders')  // scalar select subquery
  .get()

await table('t').fromSub(table('users').where('score', '>', 60), 't').get() // from (subquery)
await table('users').joinSub(teamB, 'tb', 'tb.id', '=', 'users.team_id').get()
```

```ts
const rows = await User.query()
  .select('id', 'name')
  .where('active', true)
  .whereIn('role', ['admin', 'staff'])
  .whereNotNull('email_verified_at')
  .orWhere(q => q.where('vip', true).whereBetween('score', [90, 100]))
  .join('teams', 'teams.id', '=', 'users.team_id')
  .groupBy('team_id')
  .having('count', '>', 1)
  .orderByDesc('created_at')
  .limit(20)
  .get()

// Aggregates
await User.query().count()
await User.query().where('active', true).sum('score')

// Write helpers
await User.query().where('id', 1).increment('logins')
await User.query().insertMany([{ name: 'A' }, { name: 'B' }])
await User.query().upsert([{ email: 'a@b.c', name: 'A' }], ['email'], ['name'])

// Escape hatches
.whereRaw('lower(email) = ?', ['ada@x.io'])
.selectRaw('count(*) as n')
```

Raw SQL against the connection — positional or named bindings, plus
`unprepared` for multi-statement DDL:

```ts
import { raw, rawStatement, unprepared } from '@elyvel/database'

await raw('SELECT * FROM users WHERE id = :id', { id: 1 }) // :name → ? / $n
await raw('SELECT * FROM users WHERE age > ?', [18])
await rawStatement('UPDATE users SET score = score + ? WHERE id = ?', [10, 1])
await unprepared('CREATE TABLE a (id INT); CREATE TABLE b (id INT);')
```

`raw()` returns rows; `rawStatement()` is for statements with no result set
(an UPDATE/DELETE/DDL) but that still need bindings; `unprepared()` skips
bindings entirely, for multi-statement DDL a prepared statement can't carry.

For a join with more than one condition, pass a closure instead of the
`(first, operator, second)` triple — it receives a join-clause builder with
`on`/`orOn` (column-to-column) and `where`/`orWhere` (column-to-value):

```ts
await User.query()
  .join('teams', (j) => {
    j.on('teams.id', '=', 'users.team_id').where('teams.active', '=', true)
  })
  .get()
```

Also available: `distinct`, `whereColumn`, `whereExists`, `leftJoin`,
`orderByRaw`, `union`, `lockForUpdate`, `sharedLock`, `when`, `pluck`,
`value`, `chunk`, `insertOrIgnore`, `updateOrInsert`, `decrement`.

## Relationships

```ts
class User extends Model {
  posts()   { return this.hasMany(Post) }
  profile() { return this.hasOne(Profile) }
  roles()   { return this.belongsToMany(Role) }        // via pivot
}
class Post extends Model {
  user()     { return this.belongsTo(User) }
  comments() { return this.morphMany(Comment, 'commentable') }
}
```

Full set: `hasOne`, `hasMany`, `belongsTo`, `belongsToMany`, `hasOneThrough`,
`hasManyThrough`, `morphOne`, `morphMany`, `morphTo`, `morphToMany`,
`morphedByMany`. Pivots support `withPivot`, `withTimestamps`, `as` (expose
the pivot under a custom property instead of `.pivot`), `using` (a custom
Pivot model class), and `attach` / `detach` / `sync` / `syncWithoutDetaching`
/ `toggle` / `updateExistingPivot`.

A `belongsToMany` relation's own query (not `attach`/`detach`) can also be
scoped by pivot columns:

```ts
await user.roles()
  .wherePivot('active', true)
  .wherePivotIn('assigned_by', ['admin', 'system'])
  .orderByPivot('created_at', 'desc')
  .get()
```

`wherePivot(column, operatorOrValue, value?)`, `wherePivotIn`,
`wherePivotNotIn`, `wherePivotBetween`, `wherePivotNull`, and `orderByPivot`
all constrain/order the fetched related rows by a column on the pivot
table, not the related table itself.

### Eager loading

```ts
const users = await User.query().with('posts').get()
const posts = users.first()?.getRelation('posts') // no N+1

await User.query().with('posts.comments').get()            // nested
await User.query().with({ posts: q => q.where('published', true) }).get() // constrained

// Aggregates without loading rows
await User.query().withCount('posts').get()   // → user.getAttribute('posts_count')
await User.query().withSum('posts', 'views').get()

// Existence filters
await User.query().has('posts').get()
await User.query().whereHas('posts', q => q.where('published', true)).get()
await User.query().doesntHave('posts').get()

// Lazy load onto existing instances
await user.load('posts')
await user.loadMissing('profile')
```

A few sugar methods cover common `whereHas`/relation-constraint shapes
without writing the callback out:

```ts
// Sugar for whereHas('posts', q => q.where('title', 'A1'))
await User.query().whereRelation('posts', 'title', 'A1').get()
await User.query().orWhereRelation('posts', 'title', 'A2').get()

// Constrain to rows belonging to a specific model — infers the relation
// method name from the model's class (Post → post()) unless given explicitly
await Post.query().whereBelongsTo(user).get()
await Post.query().whereBelongsTo(user, 'author').get()

// For a morphTo relation, constrain to one specific model (type AND key)
await Comment.query().whereMorphedTo('commentable', post).get()
await Comment.query().whereNotMorphedTo('commentable', post).get()

// For a belongsToMany relation, constrain to specific attached models —
// one model, an array, or a collection
await Post.query().whereAttachedTo('tags', tag).get()
await Post.query().whereAttachedTo('tags', [php, js]).get()
await Post.query().whereAttachedTo('tags', await Tag.query().get()).get()
await Post.query().whereNotAttachedTo('tags', tag).get()
```

`whereAttachedTo` with an empty list matches nothing, and
`whereNotAttachedTo` with an empty list matches everything — "attached to none
of these" is vacuously true when there are no models to be attached to.

### Collections

`Model.query().get()` returns an `EloquentCollection` — every plain
`Collection` method from [Helpers & Collections](/digging-deeper/helpers#collections)
works on it, plus model-aware ones:

```ts
const users = await User.all()

users.find(3)                    // a contained model by primary key, or undefined
users.findOrFail(3)               // same, throws if not present
users.contains(someUser)          // by model, by key, or by predicate
users.only(1, 2)                  // just these primary keys
users.except(1, 2)                // every OTHER primary key
await users.fresh()               // re-fetch every model in the collection from the DB
await users.toQuery().update({ active: true }) // bulk-update; resolves to the row count
users.makeHidden('email')         // hide an attribute on every model (chainable)
users.makeVisible('email')
```

`diff`/`intersect`/`unique` are also overridden to compare models by
primary key rather than object reference, so
`users.diff(await User.whereIn('id', ids).get())` behaves correctly even
though the two collections hold distinct object instances for the same
rows.

## Casts

```ts
static override casts = {
  id: 'int',
  active: 'boolean',
  meta: 'json',
  published_at: 'datetime',
  phone: 'encrypted',              // AES-256-GCM, needs config('app.key')
  slug: { get: v => String(v).toLowerCase() }, // custom accessor/mutator
} as const
```

Built-in types: `int`, `float`, `boolean`, `string`, `json`, `array`, `date`,
`datetime`, `encrypted`. The `encrypted` cast stores ciphertext in the
database (`iv:tag:ciphertext`, base64) and returns the decrypted value on
read.

The encryption key is set at boot from `config('app.key')` (hashed to 32
bytes, so any string works). Only reach for `setEncryptionKey()` directly
when there's no booted app to read config from — a standalone script, or a
test that exercises encrypted casts without `createApp()`:

```ts
import { setEncryptionKey } from '@elyvel/database'

setEncryptionKey(process.env.APP_KEY!)
```

Without a key set, reading or writing an `encrypted` column throws rather
than silently storing plaintext.

## Pagination

```ts
const page = await User.query().orderBy('id').paginate(15, 1)
// { data, total, perPage, currentPage, lastPage }

await User.query().simplePaginate(15) // no COUNT — { data, hasMore }
await User.query().cursorPaginate(15, cursor) // keyset pagination
```

To render prev/next/numbered links for a `paginate()` result in a
[view](/digging-deeper/views), see `paginationLinks()`.

## Soft deletes & scopes

```ts
class Post extends Model {
  static override softDeletes = true
}

await post.delete()        // sets deleted_at
await post.restore()
post.trashed()             // boolean

await Post.query().withTrashed().get()
await Post.query().onlyTrashed().get()
```

Global scopes apply to every query for a model:

```ts
Post.addGlobalScope('published', qb => qb.where('published', true))
```

## Model events & observers

Every save/delete goes through a full lifecycle of named events:
`saving`/`saved`, `creating`/`created`, `updating`/`updated`,
`deleting`/`deleted`, `trashed`, `forceDeleting`/`forceDeleted`,
`restoring`/`restored`, `retrieved`, `replicating`, `pruning`. Listen to
one directly:

```ts
Post.on('created', (post) => {
  console.log('new post:', post.id)
})
```

Group related handlers into an **observer** instead of scattering
`.on()` calls — any object (or class) whose method names match event
names:

```ts
// app/observers/PostObserver.ts
export class PostObserver {
  creating(post: Post) {
    post.slug ??= Str.slug(post.title)
  }

  deleted(post: Post) {
    logger.info(`post ${post.id} deleted`)
  }
}
```

```ts
Post.observe(PostObserver)
```

Or attach it directly on the class with the `@ObservedBy` decorator
instead of a separate `observe()` call:

```ts
@ObservedBy(PostObserver)
class Post extends Model { /* ... */ }
```

Model events stay in-process by default — they don't flow through
[`@elyvel/events`](/digging-deeper/events) unless you bridge them
explicitly:

```ts
import { event } from '@elyvel/events'
import { configureModelEventDispatcher } from '@elyvel/database'

configureModelEventDispatcher((name, model) => event(name, model))
// now: listen('eloquent.created: Post', (post) => { ... })
```

## Userstamps

Auto-populate `created_by`/`updated_by`/`deleted_by` from the currently
authenticated request user, the same way `timestamps` auto-populates
`created_at`/`updated_at`:

```ts
class Post extends Model {
  static override userstamps = true
}
```

```ts
// database/migrations/..._create_posts_table.ts
await schema.create('posts', (t) => {
  t.id()
  t.string('title')
  t.timestamps()
  t.softDeletes()
  t.userstamps()   // nullable created_by/updated_by/deleted_by, FK'd to users(id)
})
```

`created_by`/`updated_by` are set on create, `updated_by` is refreshed on
every update, and `deleted_by` is set on soft delete and cleared on restore.
Outside any authenticated request (a queued job, a seeder, a script), stamp
the actor manually with `runWithActor`:

```ts
import { runWithActor } from '@elyvel/core'

await runWithActor(userId, () => Post.create({ title: 'From a job' }))
```

`t.userstamps(usersTable?)` (see [Migrations](/database/migrations#timestamps-soft-deletes-userstamps))
defaults to the `users` table; pass a different table name if your app's user
table is named differently. Column names are customizable per-model via
`createdByColumn`/`updatedByColumn`/`deletedByColumn` (default
`created_by`/`updated_by`/`deleted_by`).

## Transactions

```ts
import { transaction } from '@elyvel/database'

await transaction(async () => {
  const user = await User.create({ name: 'Ada' })
  await Post.create({ user_id: user.id, title: 'Hello' })
  // COMMIT on success, ROLLBACK on any thrown error
})

// Retry on deadlock / serialization failures
await transaction(async () => { /* ... */ }, 3)

// Nested transactions use SAVEPOINTs — an inner rollback keeps the outer work
await transaction(async () => {
  await User.create({ name: 'outer' })
  await transaction(async () => {
    await User.create({ name: 'inner' }) // rolled back to its savepoint on throw
  })
})

// Manual control
import { beginTransaction, commit, rollBack } from '@elyvel/database'
await beginTransaction()
try {
  // ...
  await commit()
}
catch (e) {
  await rollBack()
  throw e
}
```

## Model pruning

Delete stale records in batches — schedule `elyvel model:prune` via cron.

```ts
class PersonalAccessToken extends Model {
  static override prunable() {
    return this.query()
      .whereNotNull('expires_at')
      .where('expires_at', '<', new Date().toISOString())
  }
}
```

```bash
elyvel model:prune                       # prune every prunable model
elyvel model:prune PersonalAccessToken   # prune one model
```

`prune(chunkSize = 1000)` fires a `pruning` event per record (a hook to clean
up related resources) and permanently removes matched rows, including
soft-deleted ones.

## Read/write connection split

Route reads to a replica and writes (and everything inside a transaction) to
the primary. Reads inside a transaction go to the primary too, so a query
sees its own uncommitted writes.

```ts
// config/database.ts
pgSplit: {
  driver: 'pg',
  url: process.env.DATABASE_URL, // fallback
  write: { url: 'postgres://primary:5432/app' },
  read: [
    { url: 'postgres://replica-1:5432/app' },
    { url: 'postgres://replica-2:5432/app' }, // round-robin
  ],
  sticky: true, // after a write, route that request's reads to the primary
}
```

`sticky` gives read-your-writes per HTTP request (scoped with
`AsyncLocalStorage`); reads inside a transaction always use the primary
regardless.

## Query logging & monitoring

Manual, in-memory log (à la Laravel `DB::enableQueryLog`):

```ts
const conn = useConnection()
conn.enableQueryLog()
await User.all()
conn.getQueryLog() // [{ sql, bindings, ms }]
```

Event hooks (à la Laravel `DB::listen`), usable standalone or wired to the
logger:

```ts
const off = conn.onQuery(({ sql, bindings, ms }) => { /* ... */ })
conn.onQueryError(({ sql, bindings, error }) => { /* ... */ })
conn.whenQueryingForLongerThan(500, ({ ms }) => { /* slow request */ })
```

In a framework app the `EloquentServiceProvider` bridges these to the
logger's `sql` channel automatically:

- **Query errors** are always logged (`sql`, `bindings`, `error`, `stack`) —
  the context you need to trace a failure.
- Set `log: true` in `config/database.ts` to also log every query at `debug`.
- Set `slowMs: <ms>` to warn when cumulative per-request query time is
  exceeded.

See [`examples/basic-app`](https://github.com/ufhy/elyvel/tree/main/examples/basic-app)
for a working application that uses models, migrations, seeders, encrypted
casts, and pruning end to end.
