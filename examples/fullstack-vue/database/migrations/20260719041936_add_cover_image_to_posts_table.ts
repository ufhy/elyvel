import type { Migration } from '@elyvel/database'

export default {
  up: schema =>
    schema.table('posts', (t) => {
      t.string('cover_image').nullable()
    }),
  down: schema =>
    schema.table('posts', (t) => {
      t.dropColumn('cover_image')
    }),
} satisfies Migration
