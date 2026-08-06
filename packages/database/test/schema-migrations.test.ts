import type { Connection } from '../src/connection'
import { beforeEach, describe, expect, test } from 'bun:test'
import { migrate, rollback, status } from '../src/migrator'
import { QueryBuilder } from '../src/query-builder'
import { SchemaBuilder } from '../src/schema'
import { dialects } from './dialects'

const migrationsDir = new URL('./fixtures/migrations', import.meta.url).pathname

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

    /**
     * Index names are database-global on SQLite and Postgres, so two tables
     * declaring an index over the same column names must not collide. They did:
     * the default name was `name_guard_unique` regardless of table, and the
     * second `create` failed outright. Defaults are `{table}_{columns}_{type}`
     * now, as in Laravel.
     */
    test('two tables can index the same column names', async () => {
      const schema = new SchemaBuilder(conn)
      await schema.create('alpha', (t) => {
        t.id()
        t.string('name')
        t.string('guard')
        t.unique(['name', 'guard'])
        t.index('name')
      })
      await schema.create('beta', (t) => {
        t.id()
        t.string('name')
        t.string('guard')
        t.unique(['name', 'guard'])
        t.index('name')
      })

      // Both really are unique, not merely created.
      await new QueryBuilder(conn, 'alpha').insert({ name: 'x', guard: 'web' })
      await new QueryBuilder(conn, 'beta').insert({ name: 'x', guard: 'web' })
      expect(new QueryBuilder(conn, 'alpha').insert({ name: 'x', guard: 'web' })).rejects.toThrow()
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
