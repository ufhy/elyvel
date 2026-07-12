import { beforeEach, describe, expect, test } from 'bun:test'
import { type Connection, createConnection } from '../src/connection'
import { QueryBuilder } from '../src/query-builder'
import { SchemaBuilder } from '../src/schema'

const UID = '11111111-1111-1111-1111-111111111111'

const dialects = [
  { name: 'sqlite', connect: () => createConnection({ driver: 'sqlite', database: ':memory:' }) },
  { name: 'pglite', connect: () => createConnection({ driver: 'pglite' }) },
] as const

for (const d of dialects) {
  describe(`column types (${d.name})`, () => {
    let conn: Connection
    beforeEach(async () => {
      conn = await d.connect()
      await new SchemaBuilder(conn).create('samples', (t) => {
        t.id()
        t.smallInteger('n').nullable()
        t.float('f').nullable()
        t.double('dd').nullable()
        t.char('code', 2).nullable()
        t.binary('data').nullable() // BYTEA (pg) / BLOB (sqlite) — e.g. image bytes
        t.uuid('uid').nullable() // native UUID on pg
        t.enum('status', ['active', 'inactive']).nullable()
      })
    })

    test('numeric / char / binary / uuid round-trip', async () => {
      await new QueryBuilder(conn, 'samples').insert({
        n: 7,
        f: 1.5,
        dd: 2.5,
        code: 'hi',
        data: new Uint8Array([104, 105]), // "hi"
        uid: UID,
        status: 'active',
      })
      const row = await new QueryBuilder(conn, 'samples').first()
      expect(Number(row?.n)).toBe(7)
      expect(Number(row?.f)).toBeCloseTo(1.5, 3)
      expect(Number(row?.dd)).toBeCloseTo(2.5, 3)
      expect(row?.code).toBe('hi')
      expect(Buffer.from(row?.data as Uint8Array).toString()).toBe('hi')
      expect(String(row?.uid)).toBe(UID)
      expect(row?.status).toBe('active')
    })

    test('enum CHECK rejects invalid values', async () => {
      await expect(new QueryBuilder(conn, 'samples').insert({ status: 'nope' })).rejects.toThrow()
    })
  })
}

describe('native Postgres types (pglite)', () => {
  test('jsonb + timestamptz', async () => {
    const conn = await createConnection({ driver: 'pglite' })
    await new SchemaBuilder(conn).create('events', (t) => {
      t.id()
      t.jsonb('payload')
      t.timestampTz('occurred_at')
    })
    await new QueryBuilder(conn, 'events').insert({
      payload: { kind: 'click', count: 3 },
      occurred_at: '2026-01-02T03:04:05.000Z',
    })
    const row = await new QueryBuilder(conn, 'events').first()
    expect((row?.payload as { kind: string }).kind).toBe('click') // jsonb returns parsed object
    expect(new Date(row?.occurred_at as string).toISOString()).toBe('2026-01-02T03:04:05.000Z')
  })
})
