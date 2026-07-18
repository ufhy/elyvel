import type { Migration } from '@elyvel/database'

export default {
  up: schema =>
    schema.create('comments', (t) => {
      t.id()
      t.bigInteger('post_id')
      t.string('user_id')
      t.string('author_name')
      t.text('body')
      t.timestamps()
      t.index('post_id')
    }),
  down: schema => schema.dropIfExists('comments'),
} satisfies Migration
