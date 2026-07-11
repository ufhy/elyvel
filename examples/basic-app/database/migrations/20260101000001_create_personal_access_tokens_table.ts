import { type Migration, sql } from '@elysia-ravel/orm'

export default {
  async up(db) {
    const pk = db.dialect === 'pg' ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'
    await db.execute(
      sql.raw(`
        CREATE TABLE personal_access_tokens (
          id ${pk},
          user_id INTEGER NOT NULL,
          token TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `),
    )
  },

  async down(db) {
    await db.execute(sql.raw('DROP TABLE IF EXISTS personal_access_tokens'))
  },
} satisfies Migration
