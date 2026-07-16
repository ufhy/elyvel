import type { Migration } from '@elysia-ravel/database'

export default {
  up: schema =>
    schema.create('sessions', (t) => {
      t.string('id').unique()
      t.text('payload')
      t.bigInteger('last_activity')
    }),
  down: schema => schema.dropIfExists('sessions'),
} satisfies Migration
