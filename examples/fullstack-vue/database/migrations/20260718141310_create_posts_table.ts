import type { Migration } from '@elyvel/database'

export default {
  up: schema =>
    schema.create('posts', (t) => {
      t.id()
      t.string('title')
      t.string('slug').unique()
      t.text('body')
      t.string('user_id')
      t.string('author_name')
      t.string('author_email')
      t.boolean('published').default(false)
      t.timestamp('published_at').nullable()
      t.timestamps()
      t.softDeletes()
      t.index('user_id')
      t.index('published')
    }),
  down: schema => schema.dropIfExists('posts'),
} satisfies Migration
