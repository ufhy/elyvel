import type { Migration } from '@elysia-ravel/database'

export default {
  up: schema =>
    schema.create('jobs', (t) => {
      t.uuid('id').unique()
      t.string('queue').default('default') // named queue / priority lane
      t.text('body') // serialized { job, data, config }
      t.integer('attempts').default(0)
      t.bigInteger('available_at') // epoch ms the job becomes reservable
      t.index(['queue', 'available_at']) // workers scan by queue + availability
    }),
  down: schema => schema.dropIfExists('jobs'),
} satisfies Migration
