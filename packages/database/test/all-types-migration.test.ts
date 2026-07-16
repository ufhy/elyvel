import type { Connection } from '../src/connection'
import { describe, expect, test } from 'bun:test'
import { createConnection } from '../src/connection'
import { migrate, rollback } from '../src/migrator'
import { QueryBuilder } from '../src/query-builder'

const dir = new URL('./fixtures/all-types', import.meta.url).pathname

const dialects = [
  { name: 'sqlite', connect: () => createConnection({ driver: 'sqlite', database: ':memory:' }) },
  { name: 'pglite', connect: () => createConnection({ driver: 'pglite' }) },
] as const

async function tableExists(conn: Connection, name: string): Promise<boolean> {
  try {
    await conn.select(`SELECT 1 FROM ${conn.grammar.wrap(name)} LIMIT 1`)
    return true
  }
  catch {
    return false
  }
}

for (const d of dialects) {
  describe(`migration with all column types (${d.name})`, () => {
    test('migrate creates the table, then rollback drops it', async () => {
      const conn = await d.connect()

      expect(await migrate(conn, dir)).toEqual(['0001_kitchen_sink'])
      expect(await tableExists(conn, 'kitchen_sink')).toBe(true)

      // the table is usable — insert a minimal row and read it back
      await new QueryBuilder(conn, 'kitchen_sink').insert({ name: 'row-1' })
      const row = await new QueryBuilder(conn, 'kitchen_sink').first()
      expect(row?.name).toBe('row-1')

      expect(await rollback(conn, dir)).toEqual(['0001_kitchen_sink'])
      expect(await tableExists(conn, 'kitchen_sink')).toBe(false)
    })
  })
}
