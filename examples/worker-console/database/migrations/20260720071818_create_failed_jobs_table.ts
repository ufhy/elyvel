import type { Migration } from '@elyvel/database'

export default {
  up: schema =>
    schema.create('failed_jobs', (t) => {
      t.string('id').unique()
      t.string('connection')
      t.string('queue')
      t.text('body')
      t.text('exception')
      t.bigInteger('failed_at')
    }),
  down: schema => schema.dropIfExists('failed_jobs'),
} satisfies Migration
