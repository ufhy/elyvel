import type { Migration } from '@elyvel/database'

export default {
  up: schema =>
    schema.create('failed_jobs', (t) => {
      t.id()
      t.string('uuid').unique() // FailedJobRecord.id — the app-facing identifier
      t.string('connection')
      t.string('queue')
      t.text('body')
      t.text('exception')
      t.bigInteger('failed_at') // epoch ms, matches FailedJobRecord.failedAt
      t.index('failed_at')
    }),
  down: schema => schema.dropIfExists('failed_jobs'),
} satisfies Migration
