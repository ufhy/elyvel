import { describe, expect, test } from 'bun:test'
import { type Connection, createConnection, freshMigrate, migrate, sql } from '../src/index'

const dir = new URL('./fixtures/migrations', import.meta.url).pathname

const dialects = [
  { name: 'sqlite', connect: () => createConnection({ driver: 'sqlite', database: ':memory:' }) },
  { name: 'pglite', connect: () => createConnection({ driver: 'pglite' }) },
] as const

async function tableExists(conn: Connection, name: string): Promise<boolean> {
  try {
    await conn.all(sql.raw(`SELECT 1 FROM ${name} LIMIT 1`))
    return true
  } catch {
    return false
  }
}

for (const d of dialects) {
  describe(`migrator (${d.name})`, () => {
    test('applies pending migrations and is idempotent', async () => {
      const conn = await d.connect()
      const first = await migrate(conn, dir)
      expect(first).toEqual(['0001_create_things'])
      expect(await tableExists(conn, 'things')).toBe(true)

      const second = await migrate(conn, dir)
      expect(second).toEqual([])
    })

    test('records migrations in the ledger with a batch', async () => {
      const conn = await d.connect()
      await migrate(conn, dir)
      const rows = await conn.all<{ name: string; batch: number | string }>(
        sql.raw('SELECT name, batch FROM _ravel_migrations'),
      )
      expect(rows).toHaveLength(1)
      expect(Number(rows[0]?.batch)).toBe(1)
    })

    test('fresh drops all tables and re-runs', async () => {
      const conn = await d.connect()
      await migrate(conn, dir)
      await conn.execute(sql.raw("INSERT INTO things (id, name) VALUES (1, 'stale')"))

      const applied = await freshMigrate(conn, dir)
      expect(applied).toEqual(['0001_create_things'])

      const rows = await conn.all<{ c: number | string }>(
        sql.raw('SELECT COUNT(*) AS c FROM things'),
      )
      expect(Number(rows[0]?.c)).toBe(0) // table was dropped and recreated empty
    })
  })
}
