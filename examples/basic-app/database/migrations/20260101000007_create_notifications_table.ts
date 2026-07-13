import type { Migration } from '@elysia-ravel/database'

export default {
  up: (schema) =>
    schema.create('notifications', (t) => {
      t.uuid('id').unique()
      t.string('type')
      t.string('notifiable_id') // owner of the notification
      t.text('data') // JSON payload
      t.bigInteger('read_at').nullable() // epoch ms; null = unread
      t.bigInteger('created_at')
      t.index('notifiable_id')
    }),
  down: (schema) => schema.dropIfExists('notifications'),
} satisfies Migration
