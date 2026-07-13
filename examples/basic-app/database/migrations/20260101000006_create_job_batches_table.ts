import type { Migration } from '@elysia-ravel/database'

export default {
  up: (schema) =>
    schema.create('job_batches', (t) => {
      t.uuid('id').unique()
      t.string('name').nullable()
      t.integer('total')
      t.integer('pending')
      t.integer('failed').default(0)
      t.boolean('allow_failures').default(false)
      t.bigInteger('cancelled_at').nullable()
      t.bigInteger('finished_at').nullable()
      t.bigInteger('created_at')
      t.text('on_then').nullable() // serialized callback sources
      t.text('on_catch').nullable()
      t.text('on_finally').nullable()
    }),
  down: (schema) => schema.dropIfExists('job_batches'),
} satisfies Migration
