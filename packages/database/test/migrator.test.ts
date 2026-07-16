import type { Connection } from '../src/index'
import { describe, expect, test } from 'bun:test'
import { createConnection, freshMigrate, migrate } from '../src/index'

const dir = new URL('./fixtures/migrations', import.meta.url).pathname

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
  describe(`migrator (${d.name})`, () => {
    test('applies schema-builder migrations and is idempotent', async () => {
      const conn = await d.connect()
      expect(await migrate(conn, dir)).toEqual(['0001_create_things'])
      expect(await tableExists(conn, 'things')).toBe(true)
      expect(await migrate(conn, dir)).toEqual([]) // nothing pending second time
    })

    test('records a batch in the ledger', async () => {
      const conn = await d.connect()
      await migrate(conn, dir)
      const rows = await conn.select<{ batch: number | string }>(
        'SELECT batch FROM _ravel_migrations',
      )
      expect(Number(rows[0]?.batch)).toBe(1)
    })

    test('fresh drops all tables and re-runs', async () => {
      const conn = await d.connect()
      await migrate(conn, dir)
      await conn.statement(
        `INSERT INTO ${conn.grammar.wrap('things')} (name) VALUES (${conn.grammar.placeholder(0)})`,
        ['stale'],
      )
      expect(await freshMigrate(conn, dir)).toEqual(['0001_create_things'])
      const rows = await conn.select<{ c: number | string }>('SELECT COUNT(*) AS c FROM things')
      expect(Number(rows[0]?.c)).toBe(0)
    })
  })
}
