import type { Migration } from '@elysia-ravel/database'

export default {
  up: (schema) =>
    schema.create('jobs', (t) => {
      t.uuid('id').unique()
      t.text('body') // serialized { job, data, tries }
      t.integer('attempts').default(0)
      t.bigInteger('available_at') // epoch ms the job becomes reservable
      t.index('available_at') // workers scan by availability
    }),
  down: (schema) => schema.dropIfExists('jobs'),
} satisfies Migration
