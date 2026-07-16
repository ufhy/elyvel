import type { Migration } from '@elysia-ravel/database'

export default {
  up: schema =>
    schema.create('cache', (t) => {
      t.string('key').unique()
      t.text('value')
      t.bigInteger('expiration').nullable() // epoch ms; null = forever
    }),
  down: schema => schema.dropIfExists('cache'),
} satisfies Migration
