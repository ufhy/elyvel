import type { Connection } from '../src/connection'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createConnection, startRequestScope } from '../src/connection'

// Two distinct SQLite files seeded differently prove which host a read hit.
describe('read/write sticky (per-request)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sticky-'))
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

  const readName = (c: Connection) =>
    c.select<{ name: string }>('SELECT name FROM t ORDER BY id LIMIT 1').then(r => r[0]?.name)

  test('reads hit the replica until a write occurs in the request', async () => {
    const conn = await createConnection({
      driver: 'sqlite',
      database: writeFile,
      read: { database: readFile },
      sticky: true,
    })
    startRequestScope()
    expect(await readName(conn)).toBe('from-read') // no write yet → replica
    await conn.statement('INSERT INTO t (name) VALUES (?)', ['fresh'])
    expect(await readName(conn)).toBe('from-write') // after write → primary
    await conn.close()
  })

  test('without sticky config, reads always hit the replica even after a write', async () => {
    const conn = await createConnection({
      driver: 'sqlite',
      database: writeFile,
      read: { database: readFile },
    })
    startRequestScope()
    await conn.statement('INSERT INTO t (name) VALUES (?)', ['ignored'])
    expect(await readName(conn)).toBe('from-read')
    await conn.close()
  })
})
