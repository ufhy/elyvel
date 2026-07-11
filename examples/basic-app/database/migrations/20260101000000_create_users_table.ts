import { type Migration, sql } from '@elysia-ravel/orm'

export default {
  async up(db) {
    // Raw SQL is dialect-specific; use db.dialect to stay portable.
    const pk = db.dialect === 'pg' ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'
    await db.execute(
      sql.raw(`
        CREATE TABLE users (
          id ${pk},
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          password TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `),
    )
  },

  async down(db) {
    await db.execute(sql.raw('DROP TABLE IF EXISTS users'))
  },
} satisfies Migration
