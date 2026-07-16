import type { Migration } from '@elysia-ravel/database'

export default {
  up: schema =>
    schema.create('personal_access_tokens', (t) => {
      t.id()
      t.foreignId('user_id').constrained('users').cascadeOnDelete()
      t.string('token').unique()
      t.timestamp('expires_at').nullable()
      t.timestamp('created_at').nullable()
    }),
  down: schema => schema.dropIfExists('personal_access_tokens'),
} satisfies Migration
