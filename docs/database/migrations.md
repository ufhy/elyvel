# Database: Migrations

Migrations are version control for your database schema — every change is a
timestamped file, and the schema builder compiles it to whichever driver is
configured (SQLite, Postgres, or MySQL). You never write raw DDL.

## Generating migrations

```bash
elyvel make:migration create_posts_table
```

This creates a timestamped file under `database/migrations/`:

```ts
// database/migrations/20260101000000_create_posts_table.ts
import type { Migration } from '@elyvel/database'

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

`up` applies the change; `down` reverses it. Migrations run in filename
(timestamp) order, so later migrations can always assume earlier ones already
ran.

## Column types

All Postgres data types are supported and compile down to the equivalent type
on SQLite/MySQL:

- **Numeric**: `smallInteger`, `integer`, `bigInteger`, `float`, `double`, `decimal`
- **Text**: `char`, `string`, `text`, `mediumText`, `longText`
- **Other scalars**: `boolean`, `uuid`, `binary`
- **Date/time**: `date`, `time`, `timestamp`, `timestampTz`, `datetime`
- **Network/misc**: `inet`, `cidr`, `macaddr`, `interval`
- **Structured**: `json`, `jsonb`, `enum`, array columns (`t.array('tags', 'text')`)
- **Convenience**: `t.id()` (auto-increment primary key), `t.foreignId('user_id')`
  (unsigned bigint FK column), `t.morphs('commentable')` (`commentable_id` +
  `commentable_type`, for polymorphic relationships)

Column modifiers chain fluently: `.nullable()`, `.default(value)`, `.unique()`,
`.unsigned()`, `.index()`, `.after('column')`.

### Generated columns

A column computed from an expression instead of assigned directly — MySQL,
Postgres, and SQLite (3.31+) all support `STORED` (physically written to
disk); only MySQL and SQLite also support `VIRTUAL` (computed on read,
`virtualAs()` throws on Postgres since it has no VIRTUAL generated columns):

```ts
t.integer('price')
t.integer('tax')
t.integer('total').storedAs('price + tax')     // STORED — every dialect
t.integer('doubled').virtualAs('price * 2')    // VIRTUAL — MySQL/SQLite only
```

### Indexes

```ts
t.index(['team_id', 'status'])           // a composite index
t.unique('email')                        // a standalone unique index (see also .unique() on the column itself)
t.fullText('body')                       // MySQL FULLTEXT / Postgres GIN over to_tsvector — see whereFullText()
t.fullText(['title', 'body'])            // a full-text index over multiple columns
t.spatialIndex('location')               // MySQL SPATIAL INDEX only
```

`fullText()` has no SQLite equivalent — `whereFullText()` still works there,
it just falls back to a `LIKE` approximation with no index to speed it up.
`spatialIndex()` isn't supported on SQLite at all, and needs the PostGIS
extension on Postgres (not assumed installed, so it throws there instead of
silently doing nothing).

### Table options

```ts
schema.create('reports', (t) => {
  t.temporary()               // CREATE TEMPORARY TABLE — dropped when the connection closes
  t.engine('InnoDB')          // MySQL/MariaDB only
  t.charset('utf8mb4')        // MySQL/MariaDB only
  t.collation('utf8mb4_unicode_ci') // MySQL/MariaDB only
  t.id()
  t.string('title')
})
```

`engine()`/`charset()`/`collation()` have no table-level equivalent on
Postgres/SQLite — they're silently ignored there rather than erroring, the
same way a column `.comment()` is. `temporary()` works on all three dialects.

### Foreign keys

```ts
t.foreignId('user_id').constrained('users').cascadeOnDelete()
t.foreignId('team_id').constrained().nullOnDelete() // infers table name from column
```

Other delete/update behaviors: `.restrictOnDelete()`, `.noActionOnDelete()`,
`.cascadeOnUpdate()`.

### Timestamps, soft deletes & userstamps

Three convenience helpers cover the recurring "audit" columns:

```ts
schema.create('posts', (t) => {
  t.id()
  t.timestamps()   // created_at, updated_at — auto-maintained by the ORM
  t.softDeletes()  // deleted_at — nullable, set on delete() instead of removing the row
  t.userstamps()   // created_by, updated_by, deleted_by — nullable FKs to users(id)
})
```

`t.userstamps(usersTable?)` defaults to the `users` table; pass a different
name if your app's user table is named differently. See [Eloquent:
Getting Started](/database/eloquent#userstamps) for how these columns get
auto-populated from the current request's user.

## Altering tables

```ts
export default {
  up: (schema) =>
    schema.table('posts', (t) => {
      t.string('slug').nullable()        // add a column
      t.text('body').nullable().change() // modify an existing column's type (pg only)
      t.renameColumn('title', 'headline')
      t.dropColumn('legacy')
      t.dropIndex('idx_posts_title')
    }),
  down: (schema) => schema.table('posts', (t) => t.dropColumn('slug')),
} satisfies Migration

// Rename a whole table
schema.rename('old_table', 'new_table')
```

`change()` and `dropForeign()` are Postgres-only — SQLite can't alter a
column's type or drop a column that's part of a foreign key in place; rebuild
the table instead. `dropUserstamps()` follows the same rule (SQLite throws a
clear error); on MySQL its FK constraint is looked up and dropped
automatically before the column, since MySQL (unlike Postgres) refuses to drop
a column that's still referenced by one.

## Running migrations

```bash
elyvel migrate            # run all pending migrations
elyvel migrate:fresh      # drop every table and re-run from scratch
elyvel migrate:rollback   # roll back the most recent batch
elyvel migrate:status     # show which migrations have run
elyvel db:seed            # run database seeders
```

## Inspecting the database

```bash
elyvel db                     # open the native shell (sqlite3 / psql)
elyvel db:show                # list tables with row counts
elyvel db:table users         # describe a table's columns
elyvel db:monitor --max=100   # open-connection count (Postgres)
```

## Events

Bridge migration lifecycle events to `@elyvel/events` (the same injectable
pattern as the Eloquent model-event bridge) — `migrations.started`/
`migrations.ended` fire once per `migrate()`/`rollback()`/`reset()` call,
`migration.started`/`migration.ended` fire per individual migration:

```ts
import { configureMigrationEventDispatcher } from '@elyvel/database'
import { event } from '@elyvel/events'

configureMigrationEventDispatcher((name, payload) => event(name, payload))
```

```ts
listen('migration.started', ({ name, direction }) => {
  logger.info(`Running ${direction === 'down' ? 'rollback' : 'migration'}: ${name}`)
})
```

`payload` is `{ names, direction }` for the batch-level events and `{ name,
direction }` for the per-migration ones (`direction` is `'up'` or `'down'`).
Nothing fires during `--pretend` — no migrating actually happens then.
