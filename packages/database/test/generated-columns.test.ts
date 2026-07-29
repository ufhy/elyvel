import { describe, expect, test } from 'bun:test'
import { setConnection } from '../src/connection'
import { table } from '../src/query-builder'
import { SchemaBuilder } from '../src/schema'
import { dialects } from './dialects'

for (const d of dialects) {
  describe(`generated columns — storedAs (${d.name})`, () => {
    test('a STORED generated column is computed by the database on insert', async () => {
      const conn = await d.connect()
      setConnection(conn)
      await new SchemaBuilder(conn).create('products', (t) => {
        t.id()
        t.integer('price')
        t.integer('tax')
        t.integer('total').storedAs('price + tax')
      })
      await table('products').insert({ price: 100, tax: 8 })
      const row = await table('products').first()
      expect(Number(row?.total)).toBe(108)
    })
  })

  // Postgres only supports STORED generated columns — VIRTUAL should fail
  // loudly rather than silently produce wrong DDL.
  if (d.name === 'pg' || d.name === 'pglite') {
    test(`virtualAs() throws on Postgres, no VIRTUAL generated columns there (${d.name})`, async () => {
      const conn = await d.connect()
      setConnection(conn)
      await expect(
        new SchemaBuilder(conn).create('widgets', (t) => {
          t.id()
          t.integer('price')
          t.integer('doubled').virtualAs('price * 2')
        }),
      ).rejects.toThrow(/not supported on Postgres/)
    })
  }

  // MySQL and SQLite (3.31+) both support VIRTUAL generated columns.
  if (d.name === 'mysql' || d.name === 'sqlite') {
    describe(`generated columns — virtualAs (${d.name})`, () => {
      test('a VIRTUAL generated column is computed on read', async () => {
        const conn = await d.connect()
        setConnection(conn)
        await new SchemaBuilder(conn).create('widgets', (t) => {
          t.id()
          t.integer('price')
          t.integer('doubled').virtualAs('price * 2')
        })
        await table('widgets').insert({ price: 21 })
        const row = await table('widgets').first()
        expect(Number(row?.doubled)).toBe(42)
      })
    })
  }
}
