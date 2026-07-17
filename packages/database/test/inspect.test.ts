import type { Connection } from '../src/connection'
import { beforeEach, describe, expect, test } from 'bun:test'
import { setConnection } from '../src/connection'
import { countRows, listTables, openConnectionCount, tableColumns } from '../src/inspect'
import { SchemaBuilder } from '../src/schema'
import { dialects } from './dialects'

for (const d of dialects) {
  describe(`inspect (${d.name})`, () => {
    let conn: Connection
    beforeEach(async () => {
      conn = await d.connect()
      setConnection(conn)
      await new SchemaBuilder(conn).create('widgets', (t) => {
        t.id()
        t.string('name')
        t.integer('qty').nullable()
      })
    })

    test('listTables returns user tables', async () => {
      const tables = await listTables(conn)
      expect(tables).toContain('widgets')
    })

    test('tableColumns describes columns', async () => {
      const cols = await tableColumns(conn, 'widgets')
      const names = cols.map(c => c.name)
      expect(names).toEqual(['id', 'name', 'qty'])
      expect(cols.find(c => c.name === 'qty')?.nullable).toBe(true)
      expect(cols.find(c => c.name === 'name')?.nullable).toBe(false)
    })

    test('countRows counts rows', async () => {
      await conn.statement('INSERT INTO widgets (name) VALUES (:n)', { n: 'a' })
      await conn.statement('INSERT INTO widgets (name) VALUES (:n)', { n: 'b' })
      expect(await countRows(conn, 'widgets')).toBe(2)
    })

    test('openConnectionCount is a number on pg, null on sqlite', async () => {
      const count = await openConnectionCount(conn)
      if (d.name === 'sqlite')
        expect(count).toBeNull()
      else expect(typeof count).toBe('number')
    })

    test('rejects unsafe table names', async () => {
      await expect(countRows(conn, 'widgets; DROP TABLE widgets')).rejects.toThrow(/Unsafe/)
    })
  })
}
