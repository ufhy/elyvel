import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type Connection,
  createConnection,
  defineModel,
  eq,
  integer,
  pg,
  setConnection,
  sql,
  sqliteTable,
  text,
} from '../src/index'

/** The same model suite runs against every dialect to prove portability. */
const dialects = [
  {
    name: 'sqlite',
    connect: () => createConnection({ driver: 'sqlite', database: ':memory:' }),
    table: sqliteTable('things', {
      id: integer('id').primaryKey({ autoIncrement: true }),
      name: text('name').notNull(),
    }),
    ddl: 'CREATE TABLE things (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)',
  },
  {
    name: 'pglite',
    connect: () => createConnection({ driver: 'pglite' }),
    table: pg.pgTable('things', {
      id: pg.serial('id').primaryKey(),
      name: pg.text('name').notNull(),
    }),
    ddl: 'CREATE TABLE things (id SERIAL PRIMARY KEY, name TEXT NOT NULL)',
  },
] as const

for (const d of dialects) {
  describe(`defineModel (${d.name})`, () => {
    // biome-ignore lint/suspicious/noExplicitAny: heterogeneous table types across dialects
    const Thing = defineModel(d.table as any)

    beforeEach(async () => {
      const conn: Connection = await d.connect()
      await conn.execute(sql.raw(d.ddl))
      setConnection(conn)
    })

    test('create returns the inserted row', async () => {
      const row = await Thing.create({ name: 'widget' })
      expect(row.id).toBe(1)
      expect(row.name).toBe('widget')
    })

    test('all returns every row', async () => {
      await Thing.create({ name: 'a' })
      await Thing.create({ name: 'b' })
      expect(await Thing.all()).toHaveLength(2)
    })

    test('find resolves by primary key', async () => {
      await Thing.create({ name: 'findme' })
      expect((await Thing.find(1))?.name).toBe('findme')
      expect(await Thing.find(999)).toBeUndefined()
    })

    test('where filters via a Drizzle condition', async () => {
      await Thing.create({ name: 'match' })
      await Thing.create({ name: 'other' })
      const rows = await Thing.where(eq(d.table.name, 'match'))
      expect(rows).toHaveLength(1)
      expect(rows[0]?.name).toBe('match')
    })

    test('count reflects row total', async () => {
      expect(await Thing.count()).toBe(0)
      await Thing.create({ name: 'x' })
      expect(await Thing.count()).toBe(1)
    })
  })
}
