import type { Connection } from '../src/connection'
import { beforeEach, describe, expect, test } from 'bun:test'
import { createConnection, setConnection } from '../src/connection'
import { tableColumns } from '../src/inspect'
import { table } from '../src/query-builder'
import { SchemaBuilder } from '../src/schema'

const dialects = [
  { name: 'sqlite', connect: () => createConnection({ driver: 'sqlite', database: ':memory:' }) },
  { name: 'pglite', connect: () => createConnection({ driver: 'pglite' }) },
] as const

for (const d of dialects) {
  describe(`migration ALTER (${d.name})`, () => {
    let conn: Connection
    let schema: SchemaBuilder
    beforeEach(async () => {
      conn = await d.connect()
      setConnection(conn)
      schema = new SchemaBuilder(conn)
      await schema.create('items', (t) => {
        t.id()
        t.string('name')
        t.integer('qty')
      })
    })

    test('add + drop + rename columns', async () => {
      await schema.table('items', (t) => {
        t.string('sku').nullable()
        t.dropColumn('qty')
        t.renameColumn('name', 'title')
      })
      const cols = (await tableColumns(conn, 'items')).map(c => c.name).sort()
      expect(cols).toEqual(['id', 'sku', 'title'])
    })

    test('rename table', async () => {
      await schema.rename('items', 'products')
      const tables = (await conn.select<{ n: number }>('SELECT count(*) AS n FROM products'))[0]
      expect(Number(tables?.n)).toBe(0)
    })

    test('drop index', async () => {
      await schema.table('items', t => t.index('name', 'idx_items_name'))
      await schema.table('items', t => t.dropIndex('idx_items_name'))
      // No throw = success; re-adding proves it was gone.
      await schema.table('items', t => t.index('name', 'idx_items_name'))
      expect(true).toBe(true)
    })
  })
}

describe('migration ALTER change() (pg only)', () => {
  test('changes a column type on Postgres', async () => {
    const conn = await createConnection({ driver: 'pglite' })
    setConnection(conn)
    const schema = new SchemaBuilder(conn)
    await schema.create('t', (b) => {
      b.id()
      b.string('code')
    })
    await schema.table('t', b => b.text('code').nullable().change())
    await table('t').insert({ id: 1, code: 'x'.repeat(500) }) // longer than VARCHAR(255)
    expect(await table('t').count()).toBe(1)
    await conn.close()
  })

  test('change() throws on SQLite', async () => {
    const conn = await createConnection({ driver: 'sqlite', database: ':memory:' })
    setConnection(conn)
    const schema = new SchemaBuilder(conn)
    await schema.create('t', (b) => {
      b.id()
      b.string('code')
    })
    await expect(schema.table('t', b => b.text('code').change())).rejects.toThrow(/not supported/)
    await conn.close()
  })
})
