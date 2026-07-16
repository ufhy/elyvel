import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createConnection } from '../src/connection'

// Read/write routing is dialect-agnostic (pure select→read / statement→write).
// We prove it with two distinct SQLite files seeded differently.
describe('read/write connection split', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rw-split-'))
  const readFile = join(dir, 'read.sqlite')
  const writeFile = join(dir, 'write.sqlite')

  beforeAll(async () => {
    const r = await createConnection({ driver: 'sqlite', database: readFile })
    await r.statement('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)')
    await r.statement('INSERT INTO t (name) VALUES (?)', ['from-read'])
    await r.close()

    const w = await createConnection({ driver: 'sqlite', database: writeFile })
    await w.statement('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)')
    await w.statement('INSERT INTO t (name) VALUES (?)', ['from-write'])
    await w.close()
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  test('select reads from the read host, statement writes to the write host', async () => {
    const conn = await createConnection({
      driver: 'sqlite',
      database: writeFile,
      read: { database: readFile },
    })

    const rows = await conn.select<{ name: string }>('SELECT name FROM t ORDER BY id LIMIT 1')
    expect(rows[0]?.name).toBe('from-read')

    await conn.statement('INSERT INTO t (name) VALUES (?)', ['from-composite'])
    await conn.close()

    // The insert landed on the write host, not the read host.
    const w = await createConnection({ driver: 'sqlite', database: writeFile })
    const names = (await w.select<{ name: string }>('SELECT name FROM t ORDER BY id')).map(
      r => r.name,
    )
    await w.close()
    expect(names).toContain('from-composite')
    expect(names).not.toContain('from-read')
  })

  test('reads inside a transaction route to the write host', async () => {
    const conn = await createConnection({
      driver: 'sqlite',
      database: writeFile,
      read: { database: readFile },
    })

    await conn.statement('BEGIN')
    const inTx = await conn.select<{ name: string }>('SELECT name FROM t ORDER BY id LIMIT 1')
    expect(inTx[0]?.name).toBe('from-write') // write host, not the read replica
    await conn.statement('COMMIT')

    // After COMMIT, reads route back to the read replica.
    const after = await conn.select<{ name: string }>('SELECT name FROM t ORDER BY id LIMIT 1')
    expect(after[0]?.name).toBe('from-read')
    await conn.close()
  })
})
