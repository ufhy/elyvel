import type { Migration } from '@elysia-ravel/database'

export default {
  up: schema =>
    schema.create('users', (t) => {
      t.id()
      t.string('name')
      t.string('email').unique()
      t.string('password')
      t.text('phone').nullable() // stores AES-256-GCM ciphertext (see User.casts)
      t.timestamps()
    }),
  down: schema => schema.dropIfExists('users'),
} satisfies Migration
