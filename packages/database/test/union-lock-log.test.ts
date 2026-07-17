import type { Connection } from '../src/connection'
import { beforeEach, describe, expect, test } from 'bun:test'
import { setConnection } from '../src/connection'
import { Model } from '../src/model'
import { QueryBuilder } from '../src/query-builder'
import { SchemaBuilder } from '../src/schema'
import { dialects } from './dialects'

class Item extends Model {
  static override table = 'items'
  static override timestamps = false
  declare id: number
  declare n: number
}

for (const d of dialects) {
  describe(`union / lock / query log (${d.name})`, () => {
    let conn: Connection
    beforeEach(async () => {
      conn = await d.connect()
      setConnection(conn)
      await new SchemaBuilder(conn).create('items', (t) => {
        t.id()
        t.integer('n')
      })
      for (let i = 1; i <= 12; i++) await Item.create({ n: i })
    })

    test('union', async () => {
      const low = new QueryBuilder(conn, 'items').where('n', '<', 3)
      const high = new QueryBuilder(conn, 'items').where('n', '>', 10)
      const rows = await low.union(high).get()
      expect(rows.map(r => Number(r.n)).sort((a, b) => a - b)).toEqual([1, 2, 11, 12])
    })

    test('lockForUpdate runs (FOR UPDATE on pg, no-op on sqlite)', async () => {
      const rows = await Item.query().where('n', '<', 4).lockForUpdate().get()
      expect(rows.count()).toBe(3)
    })

    test('query log records executed queries', async () => {
      conn.enableQueryLog()
      await Item.query().where('n', 5).get()
      const log = conn.getQueryLog()
      expect(log.length).toBeGreaterThanOrEqual(1)
      expect(log.some(e => e.sql.includes('SELECT'))).toBe(true)
      expect(typeof log[0]?.ms).toBe('number')
      conn.flushQueryLog()
      expect(conn.getQueryLog()).toHaveLength(0)
    })
  })
}
