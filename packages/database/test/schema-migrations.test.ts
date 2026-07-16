import type { Connection } from '../src/connection'
import { beforeEach, describe, expect, test } from 'bun:test'
import { createConnection } from '../src/connection'
import { migrate, rollback, status } from '../src/migrator'
import { QueryBuilder } from '../src/query-builder'
import { SchemaBuilder } from '../src/schema'

const migrationsDir = new URL('./fixtures/migrations', import.meta.url).pathname

const dialects = [
  { name: 'sqlite', connect: () => createConnection({ driver: 'sqlite', database: ':memory:' }) },
  { name: 'pglite', connect: () => createConnection({ driver: 'pglite' }) },
] as const

for (const d of dialects) {
  describe(`schema + migrations (${d.name})`, () => {
    let conn: Connection
    beforeEach(async () => {
      conn = await d.connect()
    })

    test('create with new column types + standalone index', async () => {
      const schema = new SchemaBuilder(conn)
      await schema.create('items', (t) => {
        t.id()
        t.uuid('uid')
        t.decimal('price', 8, 2)
        t.date('due')
        t.string('email')
        t.index('email')
      })
      const uid = '11111111-1111-1111-1111-111111111111'
      await new QueryBuilder(conn, 'items').insert({
        uid,
        price: 9.99,
        due: '2026-01-01',
        email: 'a@b.com',
      })
      const row = await new QueryBuilder(conn, 'items').where('email', 'a@b.com').first()
      expect(String(row?.uid)).toBe(uid)
      expect(Number(row?.price)).toBeCloseTo(9.99, 2)
    })

    test('Schema.table adds columns to an existing table', async () => {
      const schema = new SchemaBuilder(conn)
      await schema.create('widgets', (t) => {
        t.id()
        t.string('name')
      })
      await schema.table('widgets', (t) => {
        t.integer('qty').nullable()
      })
      await new QueryBuilder(conn, 'widgets').insert({ name: 'x', qty: 5 })
      const row = await new QueryBuilder(conn, 'widgets').first()
      expect(row?.qty).toBe(5)
    })

    test('migrate:status + migrate:rollback', async () => {
      expect((await status(conn, migrationsDir)).every(s => !s.ran)).toBe(true)
      await migrate(conn, migrationsDir)
      expect((await status(conn, migrationsDir)).every(s => s.ran)).toBe(true)

      const rolled = await rollback(conn, migrationsDir)
      expect(rolled).toEqual(['0001_create_things'])
      expect((await status(conn, migrationsDir)).every(s => !s.ran)).toBe(true)
    })
  })
}
