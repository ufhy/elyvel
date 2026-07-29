import { describe, expect, test } from 'bun:test'
import { setConnection } from '../src/connection'
import { QueryBuilder, table } from '../src/query-builder'
import { SchemaBuilder } from '../src/schema'
import { dialects } from './dialects'

for (const d of dialects) {
  describe(`table options (${d.name})`, () => {
    test('temporary() creates a usable table', async () => {
      const conn = await d.connect()
      setConnection(conn)
      await new SchemaBuilder(conn).create('scratch', (t) => {
        t.temporary()
        t.id()
        t.string('note')
      })
      await table('scratch').insert({ note: 'hi' })
      const row = await table('scratch').first()
      expect(row?.note).toBe('hi')
    })

    if (d.name === 'mysql') {
      test('engine/charset/collation are applied on MySQL', async () => {
        const conn = await d.connect()
        setConnection(conn)
        await new SchemaBuilder(conn).create('widgets_opts', (t) => {
          t.engine('InnoDB')
          t.charset('utf8mb4')
          t.collation('utf8mb4_unicode_ci')
          t.id()
          t.string('name')
        })
        const rows = await new QueryBuilder(conn, 'information_schema.TABLES')
          .select('ENGINE', 'TABLE_COLLATION')
          .where('TABLE_NAME', 'widgets_opts')
          .whereRaw('TABLE_SCHEMA = DATABASE()')
          .get()
        expect(rows[0]?.ENGINE).toBe('InnoDB')
        expect(rows[0]?.TABLE_COLLATION).toBe('utf8mb4_unicode_ci')
      })
    }
    else {
      test('engine/charset/collation are silently ignored (no table-level equivalent)', async () => {
        const conn = await d.connect()
        setConnection(conn)
        // Should not throw — these options have no meaning here and are dropped.
        await new SchemaBuilder(conn).create('widgets_opts', (t) => {
          t.engine('InnoDB')
          t.charset('utf8mb4')
          t.collation('utf8mb4_unicode_ci')
          t.id()
          t.string('name')
        })
        await table('widgets_opts').insert({ name: 'ok' })
        expect((await table('widgets_opts').first())?.name).toBe('ok')
      })
    }
  })
}
