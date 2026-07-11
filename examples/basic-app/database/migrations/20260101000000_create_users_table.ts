import type { Migration } from '@elysia-ravel/eloquent'

export default {
  up: (schema) =>
    schema.create('users', (t) => {
      t.id()
      t.string('name')
      t.string('email').unique()
      t.string('password')
      t.timestamps()
    }),
  down: (schema) => schema.dropIfExists('users'),
} satisfies Migration
