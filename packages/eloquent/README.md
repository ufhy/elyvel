# @elysia-ravel/eloquent

A Laravel Eloquent-style Active Record ORM for [Bun](https://bun.sh), built for the
[elysia-ravel](../../README.md) framework. Define your models and migrations once
and run them unchanged on **SQLite** or **Postgres** — switching databases is a
config change, not a rewrite.

- **Active Record models** with dirty tracking, events, accessors, and casts
- **Fluent query builder** (joins, subqueries, aggregates, unions, locking)
- **Relationships** + eager loading (`hasMany`, `belongsTo`, `belongsToMany`,
  `hasManyThrough`, polymorphic, morph-many-to-many)
- **Schema builder migrations** — no raw SQL, all Postgres data types
- **Casts** including `json`, `boolean`, `date`, and `encrypted` (AES-256-GCM)
- **Pagination** (length-aware, simple, cursor), **soft deletes**, **global scopes**
- **Read/write connection split** and **model pruning** for production

Drivers: `bun:sqlite` (built in), `@electric-sql/pglite` (embedded Postgres, WASM),
and `postgres` (real Postgres server, optional peer dependency).

---

## Configuration

In an elysia-ravel app, register the service provider and describe your
connections. Swapping the database is just changing `default`.

```ts
// config/database.ts
import { defineDatabaseConfig } from '@elysia-ravel/eloquent'

export default defineDatabaseConfig({
  default: process.env.DB_CONNECTION ?? 'sqlite',
  connections: {
    sqlite: { driver: 'sqlite', database: 'database/database.sqlite' },
    pglite: { driver: 'pglite', dataDir: 'database/pglite' }, // embedded PG, no server
    pg: { driver: 'pg', url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/app' },
  },
})
```

```ts
// config/app.ts
import { EloquentServiceProvider } from '@elysia-ravel/eloquent'

export default defineAppConfig({
  key: process.env.APP_KEY, // secret for `encrypted` casts (AES-256-GCM)
  providers: [EloquentServiceProvider /* , ... */],
})
```

### Standalone (no framework)

```ts
import { createConnection, setConnection } from '@elysia-ravel/eloquent'

const conn = await createConnection({ driver: 'sqlite', database: ':memory:' })
setConnection(conn) // becomes the default connection used by models
```

---

## Defining models

```ts
import { Model } from '@elysia-ravel/eloquent'

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

Overridable statics: `table`, `primaryKey`, `timestamps`, `connection`, `hidden`,
`visible`, `appends`, `casts`, `accessors`, `scopes`, `fillable`, `guarded`,
`softDeletes`, `deletedAtColumn`.

---

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

---

## Query builder

Use it through a model (`User.query()`) or standalone without a model, à la
Laravel's `DB::table()` — the standalone form returns raw rows:

```ts
import { table } from '@elysia-ravel/eloquent'

const rows = await table('users').where('active', true).orderByDesc('id').get()
await table('logs', 'pgReplica').count() // target a named connection
```

```ts
const rows = await User.query()
  .select('id', 'name')
  .where('active', true)
  .whereIn('role', ['admin', 'staff'])
  .whereNotNull('email_verified_at')
  .orWhere((q) => q.where('vip', true).whereBetween('score', [90, 100]))
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

Also available: `distinct`, `whereColumn`, `whereExists`, `leftJoin`,
`orderByRaw`, `union`, `lockForUpdate`, `sharedLock`, `when`, `pluck`, `value`,
`chunk`, `insertOrIgnore`, `updateOrInsert`, `decrement`.

---

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
`morphedByMany`. Pivots support `withPivot`, `withTimestamps`, and
`attach` / `detach` / `sync`.

### Eager loading

```ts
const users = await User.query().with('posts').get()
const posts = users.first()?.getRelation('posts') // no N+1

await User.query().with('posts.comments').get()            // nested
await User.query().with({ posts: (q) => q.where('published', true) }).get() // constrained

// Aggregates without loading rows
await User.query().withCount('posts').get()   // → user.getAttribute('posts_count')
await User.query().withSum('posts', 'views').get()

// Existence filters
await User.query().has('posts').get()
await User.query().whereHas('posts', (q) => q.where('published', true)).get()
await User.query().doesntHave('posts').get()

// Lazy load onto existing instances
await user.load('posts')
await user.loadMissing('profile')
```

---

## Casts

```ts
static override casts = {
  id: 'int',
  active: 'boolean',
  meta: 'json',
  published_at: 'datetime',
  phone: 'encrypted',              // AES-256-GCM, needs config('app.key')
  slug: { get: (v) => String(v).toLowerCase() }, // custom accessor/mutator
} as const
```

Built-in types: `int`, `float`, `boolean`, `string`, `json`, `array`, `date`,
`datetime`, `encrypted`. The `encrypted` cast stores ciphertext in the database
(`iv:tag:ciphertext`, base64) and returns the decrypted value on read.

---

## Pagination

```ts
const page = await User.query().orderBy('id').paginate(15, 1)
// { data, total, perPage, currentPage, lastPage }

await User.query().simplePaginate(15) // no COUNT — { data, hasMore }
await User.query().cursorPaginate(15, cursor) // keyset pagination
```

---

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
Post.addGlobalScope('published', (qb) => qb.where('published', true))
```

---

## Migrations & schema

Migrations use the schema builder — never raw SQL — so they run on any driver.

```ts
// database/migrations/20260101000000_create_posts_table.ts
import type { Migration } from '@elysia-ravel/eloquent'

export default {
  up: (schema) =>
    schema.create('posts', (t) => {
      t.id()
      t.foreignId('user_id').constrained('users').cascadeOnDelete()
      t.string('title')
      t.text('body').nullable()
      t.jsonb('meta')
      t.timestampTz('published_at').nullable()
      t.softDeletes()
      t.timestamps()
    }),
  down: (schema) => schema.dropIfExists('posts'),
} satisfies Migration
```

All Postgres types are supported: `smallInteger`/`integer`/`bigInteger`,
`float`/`double`/`decimal`, `char`/`string`/`text`/`mediumText`/`longText`,
`boolean`, `uuid`, `json`/`jsonb`, `binary`, `date`/`time`/`timestamp`/
`timestampTz`/`datetime`, `inet`/`cidr`/`macaddr`/`interval`, `enum`, plus
array columns (`t.array('tags', 'text')`) and `t.morphs()`.

Run them with the CLI:

```bash
ravel migrate            # run pending migrations
ravel migrate:fresh      # drop everything and re-migrate
ravel migrate:rollback   # roll back the last batch
ravel migrate:status
ravel db:seed
```

---

## Transactions

```ts
import { transaction } from '@elysia-ravel/eloquent'

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
import { beginTransaction, commit, rollBack } from '@elysia-ravel/eloquent'
await beginTransaction()
try {
  // ...
  await commit()
} catch (e) {
  await rollBack()
  throw e
}
```

---

## Model pruning

Delete stale records in batches — schedule `ravel model:prune` via cron.

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
ravel model:prune                       # prune every prunable model
ravel model:prune PersonalAccessToken   # prune one model
```

`prune(chunkSize = 1000)` fires a `pruning` event per record (a hook to clean up
related resources) and permanently removes matched rows, including soft-deleted ones.

---

## Read/write connection split

Route reads to a replica and writes (and everything inside a transaction) to the
primary. Reads inside a transaction go to the primary too, so a query sees its own
uncommitted writes.

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
}
```

---

## Query logging & monitoring

Manual, in-memory log (à la Laravel `DB::enableQueryLog`):

```ts
const conn = useConnection()
conn.enableQueryLog()
await User.all()
conn.getQueryLog() // [{ sql, bindings, ms }]
```

Event hooks (à la Laravel `DB::listen`), usable standalone or wired to the logger:

```ts
const off = conn.onQuery(({ sql, bindings, ms }) => { /* ... */ })
conn.onQueryError(({ sql, bindings, error }) => { /* ... */ })
conn.whenQueryingForLongerThan(500, ({ ms }) => { /* slow request */ })
```

In a framework app the `EloquentServiceProvider` bridges these to the logger's
`sql` channel automatically:

- **Query errors** are always logged (`sql`, `bindings`, `error`, `stack`) — the
  context you need to trace a failure.
- Set `log: true` in `config/database.ts` to also log every query at `debug`.
- Set `slowMs: <ms>` to warn when cumulative per-request query time is exceeded.

---

See [`examples/basic-app`](../../examples/basic-app) for a working application that
uses models, migrations, seeders, encrypted casts, and pruning end to end.
