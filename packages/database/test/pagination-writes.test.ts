import { beforeEach, describe, expect, test } from 'bun:test'
import { type Connection, createConnection, setConnection } from '../src/connection'
import { Model } from '../src/model'
import { QueryBuilder } from '../src/query-builder'
import { SchemaBuilder } from '../src/schema'

class Item extends Model {
  static override table = 'items'
  static override timestamps = false
  declare id: number
  declare n: number
}

const dialects = [
  { name: 'sqlite', connect: () => createConnection({ driver: 'sqlite', database: ':memory:' }) },
  { name: 'pglite', connect: () => createConnection({ driver: 'pglite' }) },
] as const

for (const d of dialects) {
  describe(`pagination + writes (${d.name})`, () => {
    let conn: Connection
    beforeEach(async () => {
      conn = await d.connect()
      setConnection(conn)
      const schema = new SchemaBuilder(conn)
      await schema.create('items', (t) => {
        t.id()
        t.integer('n')
      })
      await schema.create('kv', (t) => {
        t.string('k').unique()
        t.integer('v')
      })
      for (let i = 1; i <= 12; i++) await Item.create({ n: i })
    })

    test('simplePaginate', async () => {
      const p1 = await Item.query().orderBy('id').simplePaginate(5, 1)
      expect(p1.data.count()).toBe(5)
      expect(p1.hasMore).toBe(true)
      const p3 = await Item.query().orderBy('id').simplePaginate(5, 3)
      expect(p3.data.count()).toBe(2)
      expect(p3.hasMore).toBe(false)
    })

    test('cursorPaginate', async () => {
      const first = await Item.query().cursorPaginate(5)
      expect(first.data.count()).toBe(5)
      expect(first.nextCursor).toBe(5)
      const next = await Item.query().cursorPaginate(5, first.nextCursor as number)
      expect(next.data.first()?.id).toBe(6)
    })

    test('value / pluck', async () => {
      expect(await Item.query().where('n', 7).value<number>('id')).toBe(7)
      const ns = await Item.query().orderBy('id').limit(3).pluck<number>('n')
      expect(ns).toEqual([1, 2, 3])
    })

    test('insertMany / insertOrIgnore / updateOrInsert', async () => {
      const kv = () => new QueryBuilder(conn, 'kv')
      await kv().insertMany([
        { k: 'a', v: 1 },
        { k: 'b', v: 2 },
      ])
      expect(await kv().count()).toBe(2)

      await kv().insertOrIgnore([{ k: 'a', v: 99 }]) // duplicate key → ignored
      expect(await kv().where('k', 'a').value<number>('v')).toBe(1)

      await kv().updateOrInsert({ k: 'a' }, { v: 5 }) // exists → update
      expect(await kv().where('k', 'a').value<number>('v')).toBe(5)
      await kv().updateOrInsert({ k: 'c' }, { v: 3 }) // missing → insert
      expect(await kv().count()).toBe(3)
    })
  })
}
