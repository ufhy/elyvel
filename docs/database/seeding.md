# Database: Seeding

Populate the database with test/demo data — factories generate realistic
model instances, seeders orchestrate creating them.

## Defining a factory

A factory is a function, not a class to extend — `defineFactory(Model,
definition)` returns a factory-creator:

```ts
// database/factories/PostFactory.ts
import { defineFactory } from '@elyvel/database'
import { faker } from '@faker-js/faker'
import { Post } from '../../app/models/Post'

export const postFactory = defineFactory(Post, (i) => {
  const title = faker.lorem.sentence({ min: 4, max: 8 }).replace(/\.$/, '')
  return {
    title,
    slug: `${faker.helpers.slugify(title).toLowerCase()}-${i}`,
    body: faker.lorem.paragraphs(3, '\n\n'),
  }
})

export default postFactory
```

`definition` is `(index: number) => attributes`, called once per row —
`index` is the row's 0-based position within a batch, handy for making
each row unique (a numbered suffix, a spaced-out date).

::: tip Faker isn't bundled
There's no built-in fake-data generator — install
[`@faker-js/faker`](https://fakerjs.dev) yourself (`bun add -d
@faker-js/faker`) and import it per factory file, as shown above. `elyvel
make:factory` scaffolds the import commented out.
:::

Only return fillable/mass-assignable columns from the definition —
trusted, server-only fields (an owning user id, a `published` flag)
should come from the `overrides` passed at call time instead, since
factory-created rows go through `Model.create()` and its normal
`fillable`/`guarded` rules.

## Using a factory

```ts
import { postFactory } from '../database/factories/PostFactory'

const post = await postFactory().createOne({ user_id: user.id })

const posts = await postFactory().count(5).create({ user_id: user.id })

// Build an unsaved instance — no DB write, useful in unit tests
const draft = postFactory().makeOne({ title: 'Fixed title' })
```

`count(n)` sets the batch size (default 1); `overrides` are merged over
every generated row in that batch (the same overrides object for each —
per-row-varying overrides come from what `definition(index)` itself
computes). `create()`/`createOne()` persist through `Model.create()`
(casts, fillable rules, and `creating`/`created` observers all still
apply); `make()`/`makeOne()` build unsaved instances instead.

## Relationships

There's no relationship-aware factory API (no `.for(...)`) — create the
parent first and pass its id into the child factory's overrides:

```ts
const posts = await postFactory().count(5).create({ user_id: author.id })
for (const post of posts) {
  await commentFactory().count(2).create({ post_id: post.id })
}
```

## Factory states

There's no `.state(name, overrides)` builder either — write the variation
by hand after creating, or with a different `overrides` object per call:

```ts
const posts = await postFactory().count(5).create({ user_id: author.id })
const [scheduled, ...published] = posts

for (const post of published) {
  post.published = true
  await post.save()
}
```

## Defining a seeder

```ts
// database/seeders/BlogSeeder.ts
import { Seeder } from '@elyvel/database'
import { postFactory } from '../factories/PostFactory'

export class BlogSeeder extends Seeder {
  override async run(): Promise<void> {
    await postFactory().count(5).create({ user_id: 'seed-author' })
  }
}

export default BlogSeeder
```

Extend `Seeder` and implement `run()`. Call other seeders from within one
with `this.call(SeederClass)` — pass the class itself, not an instance:

```ts
// database/seeders/DatabaseSeeder.ts
import { Seeder } from '@elyvel/database'
import { BlogSeeder } from './BlogSeeder'

export class DatabaseSeeder extends Seeder {
  override async run(): Promise<void> {
    await this.call(BlogSeeder)
    // await this.call(UsersSeeder)
  }
}

export default DatabaseSeeder
```

## The `DatabaseSeeder` entry point

`elyvel db:seed` (and `migrate:fresh --seed`/`migrate:refresh --seed`)
always look for exactly one file: `database/seeders/DatabaseSeeder.ts`,
default-exporting a `Seeder` subclass. If it's missing, the CLI tells you
to create one: `elyvel make:seeder Database`. Compose every other seeder
from inside its `run()` via `this.call(...)` — there's no `--class=`
flag to run a different seeder directly from the CLI.

## Running seeders

```bash
elyvel db:seed                 # runs DatabaseSeeder
elyvel migrate:fresh --seed    # drop everything, re-migrate, then seed
elyvel migrate:refresh --seed  # rollback + re-migrate, then seed
```

Programmatically (from a script or a test):

```ts
import { runSeeders } from '@elyvel/database'
import { DatabaseSeeder } from '../database/seeders/DatabaseSeeder'

await runSeeders([DatabaseSeeder])
```

`runSeeders(classes)` instantiates and runs each sequentially — useful for
running just one specific seeder without going through `DatabaseSeeder`.

## Not the same `seed` as `@elyvel/testing`

`@elyvel/testing`'s `refreshDatabase({ seed })` (see
[HTTP Tests](/digging-deeper/testing#database-isolation)) shares the word
"seed" but is a **different, unrelated concept** — that `seed` callback
builds raw schema (running migrations) on a fresh connection, it doesn't
call into this Factory/Seeder system at all. To use real factories/seeders
in a test, run them explicitly afterward:

```ts
await refreshDatabase({ seed: conn => migrate(conn, migrationsDir) })
await runSeeders([DatabaseSeeder]) // or just: await postFactory().count(3).create()
```
