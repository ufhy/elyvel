import type { Migration } from '@elysia-ravel/database'

export default {
  up: (schema) =>
    schema.create('failed_jobs', (t) => {
      t.uuid('id').unique()
      t.string('connection')
      t.string('queue')
      t.text('body') // serialized { job, data, tries } — re-pushed on retry
      t.text('exception')
      t.bigInteger('failed_at') // epoch ms
    }),
  down: (schema) => schema.dropIfExists('failed_jobs'),
} satisfies Migration
