import type { Connection } from '../src/connection'
import { beforeEach, describe, expect, test } from 'bun:test'
import { QueryBuilder } from '../src/query-builder'
import { SchemaBuilder } from '../src/schema'
import { dialects } from './dialects'

const table = (conn: Connection, name: string) => new QueryBuilder(conn, name)

for (const d of dialects) {
  describe(`query builder (${d.name})`, () => {
    let conn: Connection

    beforeEach(async () => {
      conn = await d.connect()
      const schema = new SchemaBuilder(conn)
      await schema.create('sales', (t) => {
        t.id()
        t.string('region')
        t.integer('amount')
      })
      await schema.create('regions', (t) => {
        t.string('code')
        t.string('name')
      })
      await schema.create('kv', (t) => {
        t.string('k').unique()
        t.integer('v')
      })
      for (const [region, amount] of [
        ['us', 100],
        ['us', 200],
        ['eu', 50],
        ['eu', 300],
      ] as const) {
        await table(conn, 'sales').insert({ region, amount })
      }
      await table(conn, 'regions').insert({ code: 'us', name: 'United States' })
      await table(conn, 'regions').insert({ code: 'eu', name: 'Europe' })
    })

    test('aggregates', async () => {
      expect(await table(conn, 'sales').sum('amount')).toBe(650)
      expect(await table(conn, 'sales').avg('amount')).toBeCloseTo(162.5, 1)
      expect(await table(conn, 'sales').min('amount')).toBe(50)
      expect(await table(conn, 'sales').max('amount')).toBe(300)
      expect(await table(conn, 'sales').where('region', 'us').count()).toBe(2)
    })

    test('count() over groupBy/having/distinct counts result rows, not the first group', async () => {
      // 4 sales rows across 2 regions (us, eu). A grouped/distinct count must
      // be 2 (the number of groups / distinct values), not 2/4/first-group-size.
      expect(await table(conn, 'sales').groupBy('region').count()).toBe(2)
      expect(await table(conn, 'sales').select('region').distinct().count()).toBe(2)
      expect(
        await table(conn, 'sales').groupBy('region').having('region', '=', 'us').count(),
      ).toBe(1)
      // paginate() feeds off count() — its total/lastPage must be right too.
      // (select the group column so the data query is valid under strict MySQL.)
      const page = await table(conn, 'sales').select('region').groupBy('region').paginate(1, 1)
      expect(page.total).toBe(2)
      expect(page.lastPage).toBe(2)
    })

    test('whereBetween', async () => {
      expect(await table(conn, 'sales').whereBetween('amount', [100, 250]).count()).toBe(2)
    })

    test('rejects an off-allowlist operator (SQL injection guard)', () => {
      expect(() => table(conn, 'sales').where('amount', '= 0 OR 1=1 --', 0)).toThrow(/Invalid SQL operator/)
      expect(() => table(conn, 'sales').having('amount', 'evil', 1)).toThrow(/Invalid SQL operator/)
      // legit operators (incl. case-insensitive LIKE) still work
      expect(() => table(conn, 'sales').where('region', 'LIKE', 'u%')).not.toThrow()
      expect(() => table(conn, 'sales').where('amount', '>=', 100)).not.toThrow()
    })

    test('rejects an invalid ORDER BY direction (SQL injection guard)', () => {
      expect(() => table(conn, 'sales').orderBy('amount', 'ASC; DROP TABLE sales --' as never)).toThrow(/Invalid ORDER BY direction/)
      expect(() => table(conn, 'sales').orderBy('amount', 'desc')).not.toThrow()
    })

    test('inRandomOrder uses the dialect-correct function', async () => {
      const { sql } = table(conn, 'sales').inRandomOrder().toSql()
      expect(sql).toContain(conn.dialect === 'mysql' ? 'RAND()' : 'RANDOM()')
      // and it actually executes on this dialect
      expect(async () => table(conn, 'sales').inRandomOrder().get()).not.toThrow()
    })

    test('distinct select', async () => {
      const rows = await table(conn, 'sales').select('region').distinct().get()
      expect(rows.map(r => r.region).sort()).toEqual(['eu', 'us'])
    })

    test('groupBy returns one row per group', async () => {
      const rows = await table(conn, 'sales').select('region').groupBy('region').get()
      expect(rows).toHaveLength(2)
    })

    test('join', async () => {
      const rows = await table(conn, 'sales')
        .join('regions', 'sales.region', '=', 'regions.code')
        .select('sales.amount', 'regions.name')
        .where('sales.region', 'us')
        .get()
      expect(rows).toHaveLength(2)
      expect(rows[0]?.name).toBe('United States')
    })

    test('increment / decrement', async () => {
      await table(conn, 'sales').where('id', 1).increment('amount', 10)
      expect((await table(conn, 'sales').where('id', 1).first())?.amount).toBe(110)
      await table(conn, 'sales').where('id', 1).decrement('amount', 60)
      expect((await table(conn, 'sales').where('id', 1).first())?.amount).toBe(50)
    })

    test('upsert', async () => {
      await table(conn, 'kv').upsert([{ k: 'hits', v: 1 }], ['k'], ['v'])
      await table(conn, 'kv').upsert([{ k: 'hits', v: 5 }], ['k'], ['v'])
      const row = await table(conn, 'kv').where('k', 'hits').first()
      expect(row?.v).toBe(5)
      expect(await table(conn, 'kv').count()).toBe(1)
    })

    test('chunk', async () => {
      const seen: unknown[] = []
      await table(conn, 'sales').chunk(3, (rows) => {
        seen.push(...rows)
      })
      expect(seen).toHaveLength(4)
    })
  })
}
