import type { Connection } from '../src/index'
import { randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { createConnection, freshMigrate, migrate, MigrationLockError } from '../src/index'
import { dialects } from './dialects'

const dir = new URL('./fixtures/migrations', import.meta.url).pathname

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
        'SELECT batch FROM _elyvel_migrations',
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

// The migration lock is cross-connection (a real mutex row in the DB itself),
// so — unlike the dialects above, which use isolated/ephemeral connections —
// this needs two connections to the SAME on-disk database to prove anything.
describe('migration lock (cross-connection)', () => {
  async function sharedFileConnections(): Promise<[Connection, Connection, () => Promise<void>]> {
    const file = join(mkdtempSync(join(tmpdir(), 'elyvel-lock-')), `${randomUUID()}.sqlite`)
    const a = await createConnection({ driver: 'sqlite', database: file })
    const b = await createConnection({ driver: 'sqlite', database: file })
    return [a, b, async () => {
      await a.close()
      await b.close()
    }]
  }

  test('a second connection is rejected while the first holds the lock', async () => {
    const [connA, connB, cleanup] = await sharedFileConnections()
    try {
      // Simulate connA already migrating: acquire the lock row directly,
      // exactly what withMigrationLock does internally.
      await connA.statement(
        'CREATE TABLE IF NOT EXISTS _elyvel_migrations_lock (id INTEGER PRIMARY KEY, locked_at VARCHAR(255) NOT NULL)',
      )
      await connA.statement(
        'INSERT INTO _elyvel_migrations_lock (id, locked_at) VALUES (1, \'now\')',
      )

      await expect(migrate(connB, dir)).rejects.toThrow(MigrationLockError)

      // Release it (as migrate()'s own `finally` would) — connB can proceed normally.
      await connA.statement('DELETE FROM _elyvel_migrations_lock WHERE id = 1')
      expect(await migrate(connB, dir)).toEqual(['0001_create_things'])
    }
    finally {
      await cleanup()
    }
  })

  test('the lock is released after migrate() completes, so a later call succeeds', async () => {
    const [connA, connB, cleanup] = await sharedFileConnections()
    try {
      expect(await migrate(connA, dir)).toEqual(['0001_create_things'])
      // connB sees the same on-disk ledger — nothing left pending, but critically
      // this doesn't throw MigrationLockError: connA's lock was released.
      expect(await migrate(connB, dir)).toEqual([])
    }
    finally {
      await cleanup()
    }
  })
})
