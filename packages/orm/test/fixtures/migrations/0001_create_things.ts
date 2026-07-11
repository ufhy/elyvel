import { type Migration, sql } from '../../../src/index'

export default {
  async up(db) {
    // Portable DDL: valid on both SQLite and Postgres.
    await db.execute(sql.raw('CREATE TABLE things (id INTEGER PRIMARY KEY, name TEXT NOT NULL)'))
  },
  async down(db) {
    await db.execute(sql.raw('DROP TABLE IF EXISTS things'))
  },
} satisfies Migration
