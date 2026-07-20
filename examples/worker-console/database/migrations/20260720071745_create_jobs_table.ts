import type { Migration } from '@elyvel/database'

export default {
  up: schema =>
    schema.create('jobs', (t) => {
      t.string('id').unique()
      t.string('queue').default('default')
      t.text('body')
      t.integer('attempts').default(0)
      t.bigInteger('available_at')
      t.index(['queue', 'available_at'])
      t.timestamps()
    }),
  down: schema => schema.dropIfExists('jobs'),
} satisfies Migration
