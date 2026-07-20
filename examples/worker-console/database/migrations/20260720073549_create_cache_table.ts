import type { Migration } from '@elyvel/database'

export default {
  up: schema =>
    schema.create('cache', (t) => {
      t.string('key').unique()
      t.text('value')
      t.bigInteger('expires_at').nullable()
    }),
  down: schema => schema.dropIfExists('cache'),
} satisfies Migration
