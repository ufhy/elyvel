import { describe, expect, test } from 'bun:test'
import { createConnection } from '../src/connection'
import { QueryBuilder } from '../src/query-builder'
import { SchemaBuilder } from '../src/schema'

describe('array columns', () => {
  test('native Postgres arrays (pglite): store + read JS arrays', async () => {
    const conn = await createConnection({ driver: 'pglite' })
    await new SchemaBuilder(conn).create('posts', (t) => {
      t.id()
      t.array('tags', 'text') // TEXT[]
      t.array('scores', 'integer') // INTEGER[]
    })
    await new QueryBuilder(conn, 'posts').insert({ tags: ['a', 'b'], scores: [1, 2, 3] })

    const row = await new QueryBuilder(conn, 'posts').first()
    expect(row?.tags).toEqual(['a', 'b'])
    expect(row?.scores).toEqual([1, 2, 3])
  })

  test('SQLite falls back to TEXT (store JSON string)', async () => {
    const conn = await createConnection({ driver: 'sqlite', database: ':memory:' })
    await new SchemaBuilder(conn).create('posts', (t) => {
      t.id()
      t.array('tags', 'text')
    })
    // SQLite has no array type → the column is TEXT; store JSON yourself.
    await new QueryBuilder(conn, 'posts').insert({ tags: JSON.stringify(['a', 'b']) })
    const row = await new QueryBuilder(conn, 'posts').first()
    expect(JSON.parse(row?.tags as string)).toEqual(['a', 'b'])
  })
})
